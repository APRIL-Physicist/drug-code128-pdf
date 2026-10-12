"use strict";

const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const statusBox = document.getElementById("status");
const download = document.getElementById("download");
const again = document.getElementById("again");
let resultUrl = null;
let busy = false;

function setStatus(message, kind = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${kind}`.trim();
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  download.hidden = true;
  download.removeAttribute("href");
  again.hidden = true;
}

function xmlCodes(content, filename) {
  const xml = new DOMParser().parseFromString(content, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error(`${filename} 不是可读取的 XML 文件。`);
  const nodes = [...xml.getElementsByTagName("Data")];
  const codes = nodes.map(node => node.getAttribute("Code")).filter(value => value !== null);
  if (!codes.length) throw new Error(`${filename} 没有找到 Code。请选原始 XML 文件。`);
  const bad = codes.find(code => !/^\d{20}$/.test(code));
  if (bad) throw new Error(`${filename} 有不完整的 Code，请核对原始文件。`);
  const expected = filename.match(/^(\d+)件_/);
  if (expected && Number(expected[1]) !== codes.length) {
    throw new Error(`${filename} 文件名写有 ${expected[1]} 件，但只找到 ${codes.length} 个 Code，请核对。`);
  }
  return codes;
}

function drawCode(page, code, col, row, font) {
  const { rgb } = PDFLib;
  const pageWidth = 595.2756;
  const pageHeight = 841.8898;
  const margin = 18;
  const columnGap = 18;
  const columnWidth = (pageWidth - 2 * margin - columnGap) / 2;
  const rowHeight = (pageHeight - 2 * margin) / 10;
  const left = margin + col * (columnWidth + columnGap);
  const top = pageHeight - margin - row * rowHeight;
  const barcodeObject = {};
  JsBarcode(barcodeObject, code, { format: "CODE128C", displayValue: false, margin: 0 });
  const bits = barcodeObject.encodings.map(part => part.data).join("");
  const moduleWidth = Math.min(1, (columnWidth - 16) / (bits.length + 20));
  const barWidth = bits.length * moduleWidth;
  const barStart = left + (columnWidth - barWidth) / 2;
  for (let position = 0; position < bits.length;) {
    if (bits[position] === "0") { position++; continue; }
    let end = position + 1;
    while (end < bits.length && bits[end] === "1") end++;
    page.drawRectangle({ x: barStart + position * moduleWidth, y: top - 56,
      width: (end - position) * moduleWidth, height: 43, color: rgb(0, 0, 0) });
    position = end;
  }
  const labelSize = 11;
  const labelWidth = font.widthOfTextAtSize(code, labelSize);
  page.drawText(code, { x: left + (columnWidth - labelWidth) / 2, y: top - 72,
    size: labelSize, font, color: rgb(0, 0, 0) });
}

async function makePdf(codes) {
  const pdf = await PDFLib.PDFDocument.create();
  const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let start = 0; start < codes.length; start += 20) {
    const page = pdf.addPage([595.2756, 841.8898]);
    codes.slice(start, start + 20).forEach((code, index) => {
      drawCode(page, code, Math.floor(index / 10), index % 10, font);
    });
    if (start % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return await pdf.save({ useObjectStreams: true });
}

async function processFiles(fileList) {
  if (busy) return;
  const files = [...fileList];
  if (!files.length) return;
  clearResult();
  if (files.some(file => !file.name.toLowerCase().endsWith(".xml"))) {
    setStatus("请选择解压后的 XML 文件。Excel 文件中的长数字可能不完整。", "error");
    return;
  }
  busy = true;
  dropzone.setAttribute("aria-disabled", "true");
  try {
    if (!window.JsBarcode || !window.PDFLib || !window.JSZip) {
      throw new Error("页面组件未加载，请刷新网页后重试。 ");
    }
    const entries = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatus(`正在处理第 ${i + 1} / ${files.length} 个文件：${file.name}`);
      await new Promise(resolve => setTimeout(resolve, 0));
      const codes = xmlCodes(await file.text(), file.name);
      const bytes = await makePdf(codes);
      const basename = file.name.replace(/\.xml$/i, "");
      entries.push({ name: `${basename}_转自XML.pdf`, bytes, count: codes.length });
    }
    let blob;
    let filename;
    if (entries.length === 1) {
      blob = new Blob([entries[0].bytes], { type: "application/pdf" });
      filename = entries[0].name;
      download.textContent = `下载 PDF（${entries[0].count} 个条码）`;
      setStatus(`已完成：${entries[0].count} 个条码。请点击下面的绿色按钮保存。`, "success");
    } else {
      const zip = new JSZip();
      entries.forEach(entry => zip.file(entry.name, entry.bytes));
      blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      filename = "全部条形码PDF.zip";
      download.textContent = `下载全部 PDF（${entries.length} 个文件）`;
      setStatus(`已完成：${entries.length} 个 PDF，共 ${entries.reduce((n, entry) => n + entry.count, 0)} 个条码。请点击下面的绿色按钮保存。`, "success");
    }
    resultUrl = URL.createObjectURL(blob);
    download.href = resultUrl;
    download.download = filename;
    download.hidden = false;
    again.hidden = false;
  } catch (error) {
    setStatus(error.message || "处理失败，请确认选择的是原始 XML 文件。", "error");
    again.hidden = false;
  } finally {
    busy = false;
    dropzone.removeAttribute("aria-disabled");
  }
}

fileInput.addEventListener("change", () => processFiles(fileInput.files));
dropzone.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); }
});
for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, event => { event.preventDefault(); dropzone.classList.add("dragging"); });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, event => { event.preventDefault(); dropzone.classList.remove("dragging"); });
}
dropzone.addEventListener("drop", event => processFiles(event.dataTransfer.files));
again.addEventListener("click", () => { clearResult(); fileInput.value = ""; fileInput.click(); });
window.addEventListener("beforeunload", () => { if (resultUrl) URL.revokeObjectURL(resultUrl); });
