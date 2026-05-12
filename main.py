"""
astrbot_plugin_file_browser - Web 文件浏览器插件

在 Dashboard 中提供文件浏览、上传、下载和删除功能。
"""

import os
from pathlib import Path
from typing import Optional

import aiofiles
from quart import Response, jsonify, request

from astrbot.api import AstrBotConfig, logger, star
from astrbot.api.star import Context

PLUGIN_NAME = "astrbot_plugin_file_browser"


@star.register(
    PLUGIN_NAME,
    "lobster",
    "基于 Dashboard 的 Web 文件浏览器，支持文件浏览、上传、下载和删除",
    "1.0.0",
)
class FileBrowserPlugin(star.Star):
    def __init__(self, context: Context, config: AstrBotConfig) -> None:
        super().__init__(context)
        self.config = config
        self._shared_root: Optional[Path] = None

        # 注册 Web API
        context.register_web_api(
            f"/{PLUGIN_NAME}/list",
            self.api_list,
            ["GET"],
            "列出目录中的文件和子目录",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/download",
            self.api_download,
            ["GET"],
            "下载文件",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/upload",
            self._api_upload_root,
            ["POST"],
            "上传文件到共享根目录",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/upload/<path:subpath>",
            self._api_upload_subpath,
            ["POST"],
            "上传文件到指定子目录",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/delete",
            self.api_delete,
            ["POST"],
            "删除文件或空文件夹",
        )

    @property
    def shared_root(self) -> Path:
        """获取并缓存解析后的共享文件夹根路径。"""
        if self._shared_root is not None:
            return self._shared_root

        raw_path: str = self.config.get("shared_path", "workspaces").strip()

        if os.path.isabs(raw_path):
            self._shared_root = Path(raw_path).resolve()
        else:
            # 相对路径相对于 data/ 目录
            from astrbot.core.utils.astrbot_path import get_astrbot_data_path

            self._shared_root = (Path(get_astrbot_data_path()) / raw_path).resolve()

        # 确保目录存在
        self._shared_root.mkdir(parents=True, exist_ok=True)
        return self._shared_root

    def _resolve_safe(self, relative_path: str) -> Path:
        """安全解析用户提供的相对路径，防止路径穿越攻击。

        Args:
            relative_path: 用户提供的相对路径（相对于 shared_root）

        Returns:
            解析后的安全绝对路径

        Raises:
            ValueError: 路径不合法或试图穿越根目录
        """
        relative_path = relative_path.strip().lstrip("/") or "."

        # 安全检查：拒绝包含空字节或明显恶意模式的路径
        if "\x00" in relative_path or relative_path.startswith(".."):
            raise ValueError("非法的路径")

        raw = self.shared_root / relative_path
        resolved = raw.resolve()

        # 确保解析后的路径在 shared_root 内
        try:
            resolved.relative_to(self.shared_root)
        except ValueError:
            raise ValueError("路径穿越被拒绝")

        # 隐藏文件不可访问
        for part in resolved.parts[len(self.shared_root.parts) :]:
            if part.startswith("."):
                raise ValueError("无法访问隐藏文件或目录")

        return resolved

    def _get_relative(self, abs_path: Path) -> str:
        """获取相对路径字符串。"""
        try:
            rel = abs_path.relative_to(self.shared_root)
            return str(rel) if rel != Path(".") else ""
        except ValueError:
            return str(abs_path)

    def _format_size(self, size: int) -> str:
        """格式化文件大小。"""
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if size < 1024:
                return f"{size:.1f} {unit}" if size < 100 else f"{int(size)} {unit}"
            size /= 1024
        return f"{size:.1f} PB"

    # ─── API 实现 ────────────────────────────────────────────

    async def api_list(self):
        """列出目录内容。

        Query: path (可选) - 相对于共享根目录的路径
        """
        rel_path = request.args.get("path", "").strip()
        try:
            target = self._resolve_safe(rel_path)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        if not target.is_dir():
            if target.is_file():
                return jsonify({"error": "不是一个目录"}), 400
            return jsonify({"error": "路径不存在"}), 404

        entries = []
        try:
            for entry in sorted(
                target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())
            ):
                if entry.name.startswith("."):
                    continue  # 跳过隐藏文件
                stat = entry.stat()
                entries.append(
                    {
                        "name": entry.name,
                        "is_dir": entry.is_dir(),
                        "size": entry.stat().st_size if entry.is_file() else 0,
                        "size_display": (
                            self._format_size(entry.stat().st_size)
                            if entry.is_file()
                            else "—"
                        ),
                        "modified": stat.st_mtime,
                    }
                )
        except PermissionError:
            return jsonify({"error": "没有权限访问该目录"}), 403

        return jsonify(
            {
                "current_path": self._get_relative(target),
                "parent_path": self._get_relative(target.parent)
                if target != self.shared_root
                else None,
                "is_root": target == self.shared_root,
                "entries": entries,
            }
        )

    async def api_download(self):
        """下载文件。

        Query: path - 相对于共享根目录的文件路径
        """
        rel_path = request.args.get("path", "").strip()
        try:
            target = self._resolve_safe(rel_path)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        if not target.is_file():
            return jsonify({"error": "文件不存在"}), 404

        # 根据扩展名确定 MIME 类型
        import mimetypes

        mime_type, _ = mimetypes.guess_type(target.name)
        mime_type = mime_type or "application/octet-stream"

        # 对文本文件使用 utf-8 读取，二进制文件直接发送
        text_mimes = {"text/", "application/json", "application/javascript"}
        is_text = any(mime_type.startswith(prefix) for prefix in text_mimes)

        if is_text:
            async with aiofiles.open(target, encoding="utf-8") as f:
                content = await f.read()
            response = Response(content, content_type=f"{mime_type}; charset=utf-8")
        else:
            async with aiofiles.open(target, mode="rb") as f:
                content = await f.read()
            response = Response(
                content,
                content_type=mime_type,
            )

        # 正确编码中文文件名
        from urllib.parse import quote

        encoded_filename = quote(target.name)
        response.headers["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{encoded_filename}"
        )
        return response

    async def _api_upload_root(self):
        """上传文件到共享根目录。"""
        return await self._handle_upload("")

    async def _api_upload_subpath(self, subpath: str):
        """上传文件到指定子目录。"""
        return await self._handle_upload(subpath)

    async def _handle_upload(self, rel_path: str):
        """处理文件上传逻辑。

        Body: multipart/form-data, 字段名 file
        """
        try:
            target_dir = self._resolve_safe(rel_path)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        if not target_dir.is_dir():
            return jsonify({"error": "目标路径不是一个目录"}), 400

        files = await request.files
        uploaded_file = files.get("file")
        if not uploaded_file:
            return jsonify({"error": "没有上传文件"}), 400

        filename = uploaded_file.filename
        if not filename or "\x00" in filename:
            return jsonify({"error": "文件名无效"}), 400

        # 安全检查：防止路径穿越
        safe_name = Path(filename).name
        if not safe_name or safe_name.startswith("."):
            return jsonify({"error": "文件名无效"}), 400

        dest_path = target_dir / safe_name
        await uploaded_file.save(str(dest_path))

        logger.info(f"文件已上传: {dest_path}")
        return jsonify(
            {
                "message": "上传成功",
                "filename": safe_name,
                "path": self._get_relative(dest_path),
            }
        )

    async def api_delete(self):
        """删除文件或空文件夹。

        Body: JSON - { "path": "相对于共享根目录的路径" }
        """
        data = await request.get_json(silent=True)
        if not data or "path" not in data:
            return jsonify({"error": "缺少 path 参数"}), 400

        rel_path = data["path"].strip()
        try:
            target = self._resolve_safe(rel_path)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        if target == self.shared_root:
            return jsonify({"error": "不能删除根目录"}), 400

        if not target.exists():
            return jsonify({"error": "路径不存在"}), 404

        try:
            if target.is_dir():
                # 检查是否为空目录
                if any(not p.name.startswith(".") for p in target.iterdir()):
                    return jsonify({"error": "目录不为空，无法删除"}), 400
                target.rmdir()
            else:
                target.unlink()
        except PermissionError:
            return jsonify({"error": "没有权限删除"}), 403
        except OSError as e:
            return jsonify({"error": f"删除失败: {e}"}), 500

        logger.info(f"已删除: {target}")
        return jsonify({"message": "删除成功", "path": self._get_relative(target)})
