/**
 * Web 文件浏览器 - 前端逻辑
 * 通过 AstrBot Plugin Page Bridge 与后端通信
 */

const bridge = window.AstrBotPluginPage;

// ─── DOM 元素 ────────────────────────────────

const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const uploadHint = document.getElementById("upload-filename");
const refreshBtn = document.getElementById("refresh-btn");
const breadcrumb = document.getElementById("breadcrumb");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const emptyHint = document.getElementById("empty-hint");
const fileList = document.getElementById("file-list");
const fileTable = document.getElementById("file-table");

// 自定义弹窗元素
const modalOverlay = document.getElementById("modal-overlay");
const modalMessage = document.getElementById("modal-message");
const modalCancel = document.getElementById("modal-cancel");
const modalConfirm = document.getElementById("modal-confirm");

// ─── 状态 ────────────────────────────────────

let currentPath = "";
let parentPath = null;

// ─── 自定义弹窗（替代沙箱禁用的 alert / confirm） ──

/** 显示提示弹窗（仅确定按钮） */
function showModal(message) {
  return new Promise((resolve) => {
    modalMessage.textContent = message;
    modalCancel.classList.add("hidden");
    modalConfirm.textContent = "确定";
    modalOverlay.classList.remove("hidden");
    modalConfirm.onclick = () => {
      modalOverlay.classList.add("hidden");
      resolve(true);
    };
  });
}

/** 显示确认弹窗（取消 + 确定） */
function showConfirm(message) {
  return new Promise((resolve) => {
    modalMessage.textContent = message;
    modalCancel.classList.remove("hidden");
    modalConfirm.textContent = "确定";
    modalOverlay.classList.remove("hidden");
    modalConfirm.onclick = () => {
      modalOverlay.classList.add("hidden");
      resolve(true);
    };
    modalCancel.onclick = () => {
      modalOverlay.classList.add("hidden");
      resolve(false);
    };
  });
}

// ─── 工具函数 ────────────────────────────────

function getIcon(name, isDir) {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const iconMap = {
    py: "🐍", js: "🟨", ts: "🔷", html: "🌐", css: "🎨", json: "📋",
    yaml: "📋", yml: "📋", md: "📝", txt: "📄", log: "📄", xml: "📋",
    csv: "📊", pdf: "📕", docx: "📘", doc: "📘", xlsx: "📗", xls: "📗",
    pptx: "📙", ppt: "📙", png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️",
    svg: "🖼️", webp: "🖼️", mp4: "🎬", mov: "🎬", avi: "🎬", mp3: "🎵",
    wav: "🎵", flac: "🎵", zip: "📦", tar: "📦", gz: "📦", rar: "📦",
    "7z": "📦", ttf: "🔤", woff: "🔤", woff2: "🔤", exe: "⚙️",
    sh: "💻", bat: "💻", dockerfile: "🐳", lock: "🔒", gitignore: "🙈",
    env: "🔑", sqlite: "🗄️", db: "🗄️", toml: "📋", cfg: "⚙️",
    conf: "⚙️", ini: "⚙️",
  };
  return iconMap[ext] || "📄";
}

// ─── 渲染 ────────────────────────────────────

function showLoading() {
  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");
  emptyHint.classList.add("hidden");
  fileTable.classList.add("hidden");
}

function showError(msg) {
  loadingEl.classList.add("hidden");
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
  emptyHint.classList.add("hidden");
  fileTable.classList.add("hidden");
}

function showContent() {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  fileTable.classList.remove("hidden");
}

function showEmpty() {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  emptyHint.classList.remove("hidden");
  fileTable.classList.remove("hidden");
}

function renderBreadcrumb(path) {
  breadcrumb.innerHTML = "";

  const rootLink = document.createElement("a");
  rootLink.href = "#";
  rootLink.textContent = "📂 根目录";
  rootLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("");
  });
  breadcrumb.appendChild(rootLink);

  if (!path) return;

  const parts = path.split("/").filter(Boolean);
  let accumulated = "";

  parts.forEach((part, i) => {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = " / ";
    breadcrumb.appendChild(sep);

    accumulated = accumulated ? `${accumulated}/${part}` : part;

    if (i === parts.length - 1) {
      const span = document.createElement("span");
      span.className = "current";
      span.textContent = part;
      breadcrumb.appendChild(span);
    } else {
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = part;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        navigateTo(accumulated);
      });
      breadcrumb.appendChild(link);
    }
  });
}

function renderFileList(entries) {
  fileList.innerHTML = "";

  entries.forEach((entry) => {
    const tr = document.createElement("tr");

    // 名称列
    const tdName = document.createElement("td");
    const nameCell = document.createElement("div");
    nameCell.className = "name-cell";

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = getIcon(entry.name, entry.is_dir);

    const nameLink = document.createElement("a");
    nameLink.className = "name-link";
    nameLink.textContent = entry.name;
    nameLink.href = "#";

    if (entry.is_dir) {
      nameLink.addEventListener("click", (e) => {
        e.preventDefault();
        const newPath = currentPath
          ? `${currentPath}/${entry.name}`
          : entry.name;
        navigateTo(newPath);
      });
    } else {
      nameLink.addEventListener("click", (e) => {
        e.preventDefault();
        downloadFile(entry.name);
      });
    }

    nameCell.appendChild(icon);
    nameCell.appendChild(nameLink);
    tdName.appendChild(nameCell);

    // 大小列
    const tdSize = document.createElement("td");
    tdSize.className = "col-size";
    tdSize.textContent = entry.size_display;

    // 操作列
    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    tdActions.style.textAlign = "right";

    if (!entry.is_dir) {
      const dlBtn = document.createElement("button");
      dlBtn.className = "action-btn btn-download";
      dlBtn.textContent = "下载";
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        downloadFile(entry.name);
      });
      tdActions.appendChild(dlBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "action-btn btn-delete";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteEntry(entry);
    });
    tdActions.appendChild(delBtn);

    tr.appendChild(tdName);
    tr.appendChild(tdSize);
    tr.appendChild(tdActions);
    fileList.appendChild(tr);
  });
}

// ─── 数据操作 ────────────────────────────────

async function loadDirectory(path) {
  showLoading();
  try {
    const data = await bridge.apiGet("list", { path });
    if (data.error) {
      showError(data.error);
      return;
    }

    currentPath = data.current_path;
    parentPath = data.parent_path;
    renderBreadcrumb(currentPath);
    showContent();

    if (data.entries.length === 0) {
      fileList.innerHTML = "";
      showEmpty();
    } else {
      emptyHint.classList.add("hidden");
      renderFileList(data.entries);
    }
  } catch (err) {
    showError(`加载失败: ${err.message}`);
  }
}

function navigateTo(path) {
  window.location.hash = path ? `#${path}` : "";
  currentPath = path;
  loadDirectory(path);
}

async function downloadFile(filename) {
  const path = currentPath ? `${currentPath}/${filename}` : filename;
  try {
    await bridge.download("download", { path }, filename);
  } catch (err) {
    await showModal(`下载失败: ${err.message}`);
  }
}

async function uploadFile(file) {
  showLoading();
  try {
    const endpoint = currentPath ? `upload/${currentPath}` : "upload";
    const result = await bridge.upload(endpoint, file);
    if (result.error) {
      showError(result.error);
      return;
    }
    await loadDirectory(currentPath);
    fileInput.value = "";
    uploadHint.textContent = "";
  } catch (err) {
    showError(`上传失败: ${err.message}`);
  }
}

async function deleteEntry(entry) {
  const type = entry.is_dir ? "文件夹" : "文件";
  const ok = await showConfirm(`确定要删除${type}「${entry.name}」吗？\n此操作不可撤销。`);
  if (!ok) return;

  const path = currentPath ? `${currentPath}/${entry.name}` : entry.name;
  try {
    const result = await bridge.apiPost("delete", { path });
    if (result.error) {
      await showModal(`删除失败: ${result.error}`);
      return;
    }
    await loadDirectory(currentPath);
  } catch (err) {
    await showModal(`删除失败: ${err.message}`);
  }
}

// ─── 事件绑定 ────────────────────────────────

uploadBtn.addEventListener("click", () => {
  const file = fileInput.files[0];
  if (!file) {
    uploadHint.textContent = "请先选择文件";
    return;
  }
  uploadFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  uploadHint.textContent = file ? `已选择: ${file.name}` : "";
});

refreshBtn.addEventListener("click", () => {
  loadDirectory(currentPath);
});

// 弹窗点击遮罩层关闭
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.classList.add("hidden");
  }
});

// ─── 初始化 ──────────────────────────────────

async function init() {
  await bridge.ready();

  const hash = window.location.hash.replace("#", "");
  const initialPath = decodeURIComponent(hash) || "";
  currentPath = initialPath;
  await loadDirectory(initialPath);

  window.addEventListener("hashchange", () => {
    const newPath = decodeURIComponent(
      window.location.hash.replace("#", "")
    );
    if (newPath !== currentPath) {
      currentPath = newPath;
      loadDirectory(newPath);
    }
  });
}

init();
