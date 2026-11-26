// build_docx.js — PROOFLOOM 总控执行清单（Gnome Tavern 黑客松 × 商用级产品）
// 结构：封面（R4/GO-1）→ 目录（罗马页码）→ 正文 18 节（阿拉伯页码从 1 起）
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, SectionType,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableOfContents,
} = require("docx");
const fs = require("fs");
const path = require("path");
const { GO1, buildCoverR4 } = require("./docx_lib.js");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "tasks.json"), "utf-8"));
const PHASES = {};
for (const p of DATA.phases) PHASES[p.num] = p;
const TASKS = DATA.tasks;
const OUT = "/home/z/my-project/download/PROOFLOOM总控执行清单.docx";

// ── 调色板（GO-1 派生，正文黑色 Profile A）──
const P = {
  primary: "1A2330", body: "000000", secondary: "5B6B7D",
  accent: "D4875A", accentDark: "B4532A",
  innerLine: "DDD0C8", surface: "F8F0EB",
};

const safeText = (v, ph) => {
  if (v === undefined || v === null || v === "" || String(v) === "NaN" || String(v) === "undefined") return ph || "\u3010\u5f85\u586b\u5199\u3011";
  return String(v);
};

// ── 组件构造 ──
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text: safeText(text), bold: true, size: 30, color: P.primary,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: opts.after || 80 },
    children: [new TextRun({ text: safeText(text), size: 24, color: P.body,
      font: { ascii: "Times New Roman", eastAsia: "SimSun" } })],
  });
}
function note(text) {
  return new Paragraph({
    spacing: { line: 312, before: 60, after: 160 },
    children: [new TextRun({ text: safeText(text), size: 18, color: P.secondary, italics: true,
      font: { ascii: "Times New Roman", eastAsia: "SimSun" } })],
  });
}
function tableTitle(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 160, after: 80, line: 312 },
    children: [new TextRun({ text: safeText(text), bold: true, size: 21, color: P.primary,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };
function dataTable(headers, rows, widths, opts = {}) {
  const fs_ = opts.fontSize || 18;
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: headers.map((htext, i) => new TableCell({
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: GO1.table.headerBg },
      margins: cellMargins,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { line: 276 },
        children: [new TextRun({ text: safeText(htext), bold: true, size: fs_, color: GO1.table.headerText,
          font: { ascii: "Arial", eastAsia: "SimHei" } })],
      })],
    })),
  });
  const dataRows = rows.map((row, ri) => new TableRow({
    cantSplit: true,
    children: row.map((val, i) => {
      const txt = safeText(val, "\u2014");
      const isP0 = txt === "P0";
      return new TableCell({
        width: { size: widths[i], type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? "FFFFFF" : P.surface },
        margins: cellMargins,
        children: [new Paragraph({
          alignment: opts.centerCols && opts.centerCols.includes(i) ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { line: 276 },
          children: [new TextRun({ text: txt, size: fs_, color: isP0 ? P.accentDark : P.body,
            bold: isP0 || (opts.boldFirstCol && i === 0),
            font: { ascii: "Times New Roman", eastAsia: "SimSun" } })],
        })],
      });
    }),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: GO1.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: GO1.table.accentLine },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.innerLine },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [headerRow, ...dataRows],
  });
}

// 任务表（每个阶段一张）
function taskTable(tasks) {
  const rows = tasks.map(t => [t.id, t.title, t.detail, t.priority, t.due, t.deps || "\u2014"]);
  return dataTable(
    ["\u7f16\u53f7", "\u4efb\u52a1", "\u8bf4\u660e\u4e0e\u9a8c\u6536\u6807\u51c6", "\u4f18\u5148\u7ea7", "\u5efa\u8bae\u5b8c\u6210", "\u4f9d\u8d56"],
    rows, [8, 17, 43, 8, 11, 13],
    { fontSize: 16, centerCols: [0, 3, 4, 5], boldFirstCol: true });
}

// ── 正文内容 ──
const content = [];

// 一、清单使用说明与执行纪律
content.push(h1("\u4e00\u3001\u6e05\u5355\u4f7f\u7528\u8bf4\u660e\u4e0e\u6267\u884c\u7eaa\u5f8b"));
content.push(body("\u672c\u6e05\u5355\u662f PROOFLOOM \u9879\u76ee\u7684\u552f\u4e00\u6743\u5a01\u8fdb\u5ea6\u6e90\uff0c\u7531\u4e09\u4efd\u8f93\u5165\u878d\u5408\u800c\u6210\uff1a\u7528\u6237\u63d0\u4f9b\u7684\u4e24\u4efd MASTER DIRECTIVE\uff08\u4ea7\u54c1\u5f00\u53d1\u4e0e\u65d7\u8230\u5236\u9020\u6307\u4ee4\uff09\u3001\u5df2\u6838\u5b9e\u7684 DoraHacks Gnome Tavern \u9ed1\u5ba2\u677e\u9875\u9762\u8981\u6c42\uff0c\u4ee5\u53ca\u5546\u7528\u7ea7\u4ea7\u54c1\u7684\u901a\u7528\u5de5\u7a0b\u6807\u51c6\u3002\u6e05\u5355\u5171 13 \u4e2a\u9636\u6bb5\u3001119 \u9879\u4efb\u52a1\uff0c\u6309\u4f18\u5148\u7ea7\u5206\u4e3a P0\uff08\u63d0\u4ea4\u5fc5\u9700\uff0977 \u9879\u3001P1\uff08\u5546\u7528\u5b8c\u5584\uff0932 \u9879\u3001P2\uff08\u8d5b\u540e\u589e\u5f3a\uff0910 \u9879\u3002\u65f6\u95f4\u57fa\u51c6\uff1a\u542f\u52a8\u65e5 D0 \u4e3a 2026-11-27\uff0c\u63d0\u4ea4\u786c\u622a\u6b62\u4e3a 2026-12-18 01:00 UTC\uff0c\u5185\u90e8\u51bb\u7ed3\u7ebf\u4e3a 12-17\u3002"));
content.push(body("\u6bcf\u9879\u4efb\u52a1\u542b\u516d\u4e2a\u5b57\u6bb5\uff1a\u7f16\u53f7\uff08T-001 \u81f3 T-119\uff0c\u4e0e\u914d\u5957\u8ffd\u8e2a\u8868\u4e00\u4e00\u5bf9\u5e94\uff09\u3001\u4efb\u52a1\u540d\u3001\u8bf4\u660e\u4e0e\u9a8c\u6536\u6807\u51c6\u3001\u4f18\u5148\u7ea7\u3001\u5efa\u8bae\u5b8c\u6210\u65e5\uff08\u5747\u4e3a 2026 \u5e74\uff09\u4e0e\u4f9d\u8d56\u7f16\u53f7\u3002\u6267\u884c\u65f6\u5148\u770b\u4f9d\u8d56\u518d\u5f00\u5de5\uff1b\u5b8c\u6210\u4e0e\u5426\u4ee5\u8bf4\u660e\u680f\u7684\u9a8c\u6536\u6807\u51c6\u4e3a\u51c6\uff0c\u4e0d\u4ee5\u4ee3\u7801\u5199\u5b8c\u4e3a\u51c6\uff1b\u6bcf\u9879\u5b8c\u6210\u5fc5\u987b\u5728\u6d3b\u6587\u6863\u4e2d\u7559\u4e0b\u8bc1\u636e\uff08\u6d4b\u8bd5\u8f93\u51fa\u3001\u4ea4\u6613\u54c8\u5e0c\u3001\u622a\u56fe\uff09\u3002\u4e0e\u672c\u6587\u6863\u914d\u5957\u7684\u6267\u884c\u8ffd\u8e2a\u8868\uff08xlsx\uff09\u63d0\u4f9b\u53ef\u8fc7\u6ee4\u3001\u53ef\u7edf\u8ba1\u7684\u72b6\u6001\u5217\uff0c\u5efa\u8bae\u6bcf\u65e5\u66f4\u65b0\u3002"));
content.push(tableTitle("\u8868 1-1 \u4f18\u5148\u7ea7\u5b9a\u4e49\u4e0e\u6267\u884c\u89c4\u5219"));
content.push(dataTable(
  ["\u6807\u8bb0", "\u542b\u4e49", "\u6267\u884c\u8981\u6c42"],
  [
    ["P0", "\u63d0\u4ea4\u5fc5\u9700\uff1a\u76f4\u63a5\u5f71\u54cd\u9ed1\u5ba2\u677e\u5408\u89c4\u4e0e\u8bc4\u5206", "\u4e0d\u53ef\u88c1\u526a\uff1b\u53d7\u963b\u65f6\u7acb\u5373\u5347\u7ea7\u5e76\u8bb0\u5165 BLOCKERS.md"],
    ["P1", "\u5546\u7528\u5b8c\u5584\uff1a\u51b3\u5b9a\u4ea7\u54c1\u6210\u719f\u5ea6\u4e0e\u8bc4\u5206\u4e0a\u9650", "\u65f6\u95f4\u4e0d\u8db3\u65f6\u53ef\u964d\u7ea7\u4e3a\u8d5b\u540e\u5b8c\u6210\uff0c\u4f46\u9700\u5728\u63d0\u4ea4\u6750\u6599\u4e2d\u5982\u5b9e\u6807\u6ce8"],
    ["P2", "\u8d5b\u540e\u589e\u5f3a\uff1a\u4e0d\u963b\u585e\u63d0\u4ea4", "\u4ec5\u5728\u5173\u952e\u8def\u5f84\u7a7a\u95f2\u671f\u63a8\u8fdb\uff1b\u7edd\u4e0d\u6324\u5360 P0 \u8d44\u6e90"],
    ["\u72b6\u6001", "\u672a\u5f00\u59cb / \u8fdb\u884c\u4e2d / \u5df2\u5b8c\u6210 / \u53d7\u963b", "\u53ea\u5141\u8bb8\u56db\u6001\uff1b\u53d7\u963b\u5fc5\u987b\u540c\u6b65\u5199\u660e\u963b\u585e\u539f\u56e0\u4e0e\u6240\u9700\u5916\u90e8\u6761\u4ef6"],
  ],
  [10, 42, 48], { centerCols: [0] }));
content.push(body("\u6267\u884c\u7eaa\u5f8b\u6765\u81ea directives \u7684\u5341\u516b\u6761\u6267\u884c\u89c4\u5219\uff0c\u6d53\u7f29\u4e3a\u4e94\u6761\u94c1\u5f8b\uff1a\u7b2c\u4e00\uff0c\u6784\u5efa\u771f\u5b9e\u4ea7\u54c1\u800c\u975e\u6a21\u62df\uff0c\u7edd\u4e0d\u7528\u4f2a\u9020\u4ea4\u6613\u3001\u786c\u7f16\u6570\u636e\u6216\u6446\u8bbe\u754c\u9762\u5145\u5f53\u529f\u80fd\uff1b\u7b2c\u4e8c\uff0c\u5148\u9a8c\u8bc1\u540e\u5ba3\u79f0\uff0c\u672a\u7ecf\u6d4b\u8bd5\u4e0e\u90e8\u7f72\u590d\u6838\u7684\u529f\u80fd\u4e0d\u5f97\u6807\u8bb0\u4e3a\u5b8c\u6210\uff1b\u7b2c\u4e09\uff0c\u6bcf\u4e2a\u91cd\u8981\u52a8\u4f5c\u53ef\u5ba1\u8ba1\uff0c\u6bcf\u9879\u5b8c\u6210\u9879\u5e26\u8bc1\u636e\uff1b\u7b2c\u56db\uff0c\u4e0d\u5f97\u505c\u7559\u5728\u8ba1\u5212\u9636\u6bb5\uff0c\u4e5f\u4e0d\u5f97\u5728\u9996\u6b21\u672c\u5730\u6784\u5efa\u6210\u529f\u540e\u505c\u6b62\uff1b\u7b2c\u4e94\uff0c\u6240\u6709\u80fd\u529b\u5982\u5b9e\u5206\u7ea7\uff08\u5df2\u5b9e\u73b0\u5e76\u9a8c\u8bc1 / \u5df2\u90e8\u7f72\u8fd0\u884c / \u5916\u90e8\u53d7\u963b / \u8ba1\u5212\u4e2d\uff09\u3002\u4efb\u4f55\u504f\u79bb\u672c\u6e05\u5355\u7684\u51b3\u5b9a\u5fc5\u987b\u8bb0\u5165 DECISIONS.md \u5e76\u8bf4\u660e\u7406\u7531\u3002"));

// 二、已核实的黑客松关键事实
content.push(h1("\u4e8c\u3001\u5df2\u6838\u5b9e\u7684\u9ed1\u5ba2\u677e\u5173\u952e\u4e8b\u5b9e"));
content.push(body("\u4ee5\u4e0b\u4e8b\u5b9e\u4e8e 2026-11-27 \u81ea DoraHacks Gnome Tavern \u9ed1\u5ba2\u677e\u9875\u9762\u6838\u5b9e\uff0c\u5305\u62ec\u65f6\u95f4\u7ebf\u3001\u5956\u91d1\u7ed3\u6784\u3001\u8bc4\u5206\u6807\u51c6\u4e0e\u63d0\u4ea4\u8981\u6c42\u3002\u4e3b\u529e\u65b9\u4e3a GnoLand (BVI) Limited\uff0c\u5e73\u53f0\u4e3a DoraHacks\uff1b\u4e3b\u529e\u65b9\u4fdd\u7559\u8c03\u6574\u65f6\u95f4\u3001\u5956\u9879\u4e0e\u540d\u989d\u7684\u6743\u5229\uff0c\u6267\u884c\u4e2d\u5e94\u4ee5\u9875\u9762\u6700\u65b0\u516c\u793a\u4e3a\u51c6\u3002"));
content.push(tableTitle("\u8868 2-1 \u65f6\u95f4\u7ebf\uff08\u542b\u4e09\u65f6\u533a\u5bf9\u7167\uff09"));
content.push(dataTable(
  ["\u65f6\u95f4 (UTC)", "\u4e8b\u4ef6", "\u5185\u7f57\u6bd5 (UTC+3)", "\u5317\u4eac (UTC+8)"],
  [
    ["2026-11-23 01:00", "\u63d0\u4ea4\u5f00\u653e\uff08\u5df2\u5f00\u653e\uff09", "11-23 04:00", "11-23 09:00"],
    ["2026-11-27", "\u672c\u6e05\u5355\u542f\u52a8\uff08\u5269\u4f59 21 \u5929\uff09", "11-27", "11-27"],
    ["2026-12-18 01:00", "\u63d0\u4ea4\u786c\u622a\u6b62", "12-18 04:00", "12-18 09:00"],
    ["2026-12-18 \u81f3 21", "\u8bc4\u5ba1\u671f", "\u2014", "\u2014"],
    ["2026-12-21", "\u83b7\u5956\u516c\u793a\u5e76\u8054\u7cfb KYC", "\u2014", "\u2014"],
    ["2026-12-22", "KYC \u622a\u6b62\uff08\u903e\u671f\u5ef6\u8fdf\u6d3e\u5956\uff09", "\u2014", "\u2014"],
    ["2026-12-23 \u81f3 24", "\u5956\u91d1\u6d3e\u53d1\uff08GNOT \u6216\u5408\u89c4\u9700\u8981\u65f6 USDC\uff09", "\u2014", "\u2014"],
  ],
  [22, 40, 19, 19], { centerCols: [0, 2, 3] }));
content.push(tableTitle("\u8868 2-2 \u5956\u91d1\u7ed3\u6784\uff08\u603b\u6c60 40,000 \u7f8e\u5143\uff0c\u4ee5 GNOT \u652f\u4ed8\uff09"));
content.push(dataTable(
  ["\u5956\u9879", "\u540d\u989d", "\u91d1\u989d", "Retention \u53e0\u52a0\u4e0a\u9650"],
  [
    ["\u4e00\u7b49\u5956", "1 \u4e2a\u9879\u76ee", "$2,000", "\u6700\u591a $8,000 \u603b\u8ba1"],
    ["\u4e8c\u7b49\u5956", "1 \u4e2a\u9879\u76ee", "$1,000", "\u6700\u591a $4,000 \u603b\u8ba1"],
    ["Builder Awards", "14 \u4e2a\u9879\u76ee", "\u6bcf\u9879 $500\uff08\u5408\u8ba1 $7,000\uff09", "\u6bcf\u9879\u6700\u591a $2,000 \u603b\u8ba1"],
    ["\u524d\u7f6e\u5956\u5408\u8ba1", "16 \u4e2a\u9879\u76ee", "$10,000", "\u2014"],
    ["Builder Retention \u5956", "\u6309\u6c38\u7eed\u8d28\u8bc4\u5b9a", "\u6700\u591a $30,000", "M3 \u8bc4\u5ba1\u4e0e M6 \u8bc4\u5ba1\u4e24\u6b21\u53d1\u653e"],
  ],
  [22, 20, 30, 28], { centerCols: [1] }));
content.push(tableTitle("\u8868 2-3 \u8bc4\u5206\u6807\u51c6\u4e0e\u53d6\u6d88\u8d44\u683c\u6761\u6b3e"));
content.push(dataTable(
  ["\u7ef4\u5ea6", "\u6743\u91cd", "\u5bf9\u5e94\u672c\u6e05\u5355\u7684\u91cd\u70b9"],
  [
    ["\u6280\u672f\u8d28\u91cf", "40%", "Phase 2/3/4\uff1aGno \u5de5\u7a0b\u3001\u94fe\u4e0a\u96c6\u6210\u4e0e\u6838\u5fc3\u57df\u7684\u6b63\u786e\u6027\u4e0e\u4e00\u81f4\u6027"],
    ["\u7528\u6237\u5438\u5f15\u529b", "20%", "Phase 7\uff1aATELIER \u8bbe\u8ba1\u3001\u6d41\u7545\u4f53\u9a8c\u3001\u5b8c\u6574\u72b6\u6001\u4e0e\u79fb\u52a8\u7aef\u53ef\u7528\u6027"],
    ["\u521b\u610f\u5ea6", "20%", "\u8f6f\u4ef6\u6eaf\u6e90 + AI Agent \u95ee\u8d23\u7684\u539f\u521b\u5b9a\u4f4d\u4e0e Proof Atlas \u4f53\u9a8c"],
    ["\u6587\u6863\u4e0e\u6f14\u793a", "20%", "Phase 10\uff1aREADME\u3001\u67b6\u6784\u6587\u6863\u30012:45 \u6f14\u793a\u89c6\u9891\u4e0e\u63d0\u4ea4\u63cf\u8ff0"],
    ["\u786c\u6027\u95e8\u69db", "\u4e00\u7968\u5426\u51b3", "\u65e0\u6d4b\u8bd5\u7f51\u90e8\u7f72\u3001\u65e0\u516c\u5f00\u4ed3\u5e93\u3001\u65e0\u771f\u5b9e Gno \u4f7f\u7528\uff0c\u5747\u76f4\u63a5\u53d6\u6d88\u8d44\u683c"],
  ],
  [18, 14, 68], { centerCols: [1] }));
content.push(tableTitle("\u8868 2-4 \u63d0\u4ea4\u8981\u6c42\u3001\u4e0d\u5408\u683c\u60c5\u5f62\u4e0e\u547d\u540d\u89c4\u5219"));
content.push(dataTable(
  ["\u7c7b\u522b", "\u5185\u5bb9", "\u5bf9\u5e94\u4efb\u52a1"],
  [
    ["\u786c\u6027\u8981\u6c42", "\u6d4b\u8bd5\u7f51\u5b9e\u65f6\u90e8\u7f72 + \u90e8\u7f72\u94fe\u63a5", "T-110"],
    ["\u786c\u6027\u8981\u6c42", "\u516c\u5f00\u4ee3\u7801\u4ed3\u5e93", "T-106"],
    ["\u786c\u6027\u8981\u6c42", "\u771f\u5b9e Gno \u7ec4\u4ef6\uff08realm \u6216 package\uff09", "T-040"],
    ["\u786c\u6027\u8981\u6c42", "README \u8bf4\u660e\u7528\u9014\u4e0e\u4f7f\u7528\u65b9\u6cd5", "T-101"],
    ["\u786c\u6027\u8981\u6c42", "\u6f14\u793a\u89c6\u9891\u5c55\u793a\u9879\u76ee\u8fd0\u884c", "T-103"],
    ["\u786c\u6027\u8981\u6c42", "\u7b80\u77ed\u9879\u76ee\u63cf\u8ff0", "T-105"],
    ["\u4e0d\u5408\u683c", "\u7eaf\u8bbe\u8ba1\u7a3f / \u5e7b\u706f\u7247 / \u6982\u5ff5\u7a3f\uff1b\u672a\u90e8\u7f72\u4ee3\u7801\uff1b\u65e0\u771f\u5b9e Gno \u7ec4\u4ef6\uff1b\u91cd\u590d\u3001\u590d\u5236\u6216\u6279\u91cf\u751f\u6210\u6761\u76ee", "T-109"],
    ["\u547d\u540d\u89c4\u5219", "\u9879\u76ee\u540d\u4e0d\u5f97\u4f7f\u7528 Gno \u524d\u7f00\u6216\u6697\u793a\u5b98\u65b9\u5173\u8054\uff0c\u8fdd\u53cd\u53ef\u80fd\u53d6\u6d88\u8d44\u683c\uff08PROOFLOOM \u5408\u89c4\uff09", "T-010"],
    ["\u8d44\u683c\u89c4\u5219", "\u5e74\u6ee1 18 \u5468\u5c81\u4e14\u975e\u53d7\u5236\u88c1\u5730\u533a\uff1b\u53ef\u5047\u540d\u53c2\u8d5b\uff1b\u6bcf\u9879\u76ee\u4ec5\u53ef\u63d0\u4ea4\u4e00\u6b21\uff0c\u56e2\u961f\u53ef\u63d0\u4ea4\u591a\u4e2a\u4e0d\u540c\u9879\u76ee\uff1b\u53c2\u8d5b\u8005\u4fdd\u7559\u5168\u90e8\u6240\u6709\u6743", "T-112"],
  ],
  [16, 62, 22], { centerCols: [0, 2] }));
content.push(note("\u6ce8\uff1aBuilder Retention \u5956\u7684\u516b\u9879\u6301\u7eed\u6027\u6807\u51c6\uff08\u6708\u5ea6\u53d1\u5e03\u3001\u72ec\u7acb\u5730\u5740 50/100\u3001\u4ea4\u6613 500/1500\u3001\u6708\u6d3b 20/50\u3001\u5916\u90e8\u9879\u76ee\u5bfc\u5165\u3001\u793e\u533a 200/500\u3001\u6bcf\u6708\u4e24\u6b21\u516c\u5f00\u66f4\u65b0\u7b49\uff09\u5df2\u6536\u5f55\u4e8e Phase 12 \u4e0e\u8ffd\u8e2a\u8868 Retention KPI \u5de5\u4f5c\u8868\uff1b\u56e2\u961f\u51fa\u8d44\u94b1\u5305\u4e0d\u8ba1\u5165\u7528\u91cf\uff0c\u64cd\u7eb5\u7528\u91cf\u5c06\u88ab\u53d6\u6d88\u8d44\u683c\u3002"));

// 三、范围基线与关键决策
content.push(h1("\u4e09\u3001\u8303\u56f4\u57fa\u7ebf\u4e0e\u5173\u952e\u51b3\u7b56"));
content.push(body("directives \u8981\u6c42\u4ea4\u4ed8\u5168\u91cf\u4ea7\u54c1\u800c\u975e MVP\uff0c\u540c\u65f6 21 \u5929\u5185\u5fc5\u987b\u5b8c\u6210\u771f\u5b9e\u90e8\u7f72\u4e0e\u63d0\u4ea4\u3002\u4e3a\u517c\u987e\u4e24\u8005\uff0c\u672c\u6e05\u5355\u91c7\u7528\u53cc\u8f68\u7b56\u7565\uff1a\u5173\u952e\u8def\u5f84\uff08\u534f\u8bae\u2192\u94fe\u4e0a\u96c6\u6210\u2192\u6838\u5fc3\u57df\u2192\u9a8c\u6536\u2192\u63d0\u4ea4\uff09\u4e0a\u7684 P0 \u4efb\u52a1\u4fdd\u8bc1\u5b8c\u6210\uff1b\u4e0e\u4e4b\u5e76\u884c\u7684\u8bbe\u8ba1\u3001\u524d\u7aef\u4e0e\u751f\u6001\u5de5\u4f5c\u6d41\u6309 P1 \u63a8\u8fdb\uff0c\u65f6\u95f4\u4e0d\u8db3\u65f6\u53ef\u964d\u7ea7\u800c\u4e0d\u4f24\u5bb3\u63d0\u4ea4\u3002\u4e0b\u8868\u8bb0\u5f55\u672c\u6e05\u5355\u7684\u516b\u9879\u57fa\u7ebf\u51b3\u7b56\uff0c\u5747\u5df2\u5199\u5165 DECISIONS.md\uff0c\u6267\u884c\u4e2d\u4e0d\u5f97\u9759\u9ed8\u504f\u79bb\u3002"));
content.push(tableTitle("\u8868 3-1 \u57fa\u7ebf\u51b3\u7b56\u8bb0\u5f55"));
content.push(dataTable(
  ["\u51b3\u7b56\u70b9", "\u51b3\u5b9a", "\u4f9d\u636e"],
  [
    ["\u4ea7\u54c1\u8303\u56f4", "\u5168\u91cf\u67b6\u6784 + \u5b8c\u6574\u5b9e\u73b0\u5fc5\u9700\u57df\uff0c\u4e0d\u964d\u683c\u4e3a\u5355\u5408\u7ea6\u52a0\u4eea\u8868\u76d8", "directives PART I\uff1b\u8bc4\u5206\u6743\u91cd"],
    ["\u9879\u76ee\u547d\u540d", "PROOFLOOM\uff08\u65e0 Gno \u524d\u7f00\uff0c\u5168\u7ebf\u54c1\u724c\u590d\u67e5\uff09", "\u9ed1\u5ba2\u677e\u547d\u540d\u89c4\u5219"],
    ["\u76ee\u6807\u7f51\u7edc", "Onyx \u6d4b\u8bd5\u7f51\uff08onyx-1\uff09\uff1b\u4e3b\u7f51\u4e3a\u8d5b\u540e\u72ec\u7acb\u5ba1\u6279\u95e8", "\u9ed1\u5ba2\u677e\u4ec5\u8981\u6c42\u6d4b\u8bd5\u7f51\u90e8\u7f72\uff1bdirectives PART XVI"],
    ["\u8bbe\u8ba1\u4ee4\u724c\u8c03\u548c", "\u4ee5\u65d7\u8230\u6307\u4ee4\u8272\u677f\u4e3a\u51c6\uff08Obsidian #090D11\u3001Verdigris #55D8C2\u7b49\uff09\uff0c\u9996\u4efd\u6307\u4ee4\u8272\u677f\u4f5c\u4e3a\u517c\u5bb9\u522b\u540d\uff0c\u8bb0\u5f55 ADR-001", "\u4e24\u4efd directives \u8272\u677f\u5b58\u5728\u5dee\u5f02"],
    ["gnomcp \u5904\u7f6e", "\u4ec5\u4f5c\u53ef\u9009\u9002\u914d\u5668\uff0c\u53ea\u8bfb\u4f18\u5148\uff0c\u4e0d\u4f5c\u5173\u952e\u4f9d\u8d56\uff0c\u6210\u719f\u5ea6\u5982\u5b9e\u6587\u6863\u5316", "directives PART IV \u00a79\uff08WIP\u3001\u672a\u5ba1\u8ba1\u3001\u9884\u53d1\u5e03\uff09"],
    ["\u6f14\u793a\u89c6\u9891", "\u76ee\u6807 2:45\uff0c\u6309 directives \u4e03\u6bb5\u5206\u955c\uff0c\u5168\u90e8\u771f\u5b9e\u6570\u636e\u4e0e\u771f\u5b9e\u4ea4\u6613", "directives PART XIV"],
    ["\u63d0\u4ea4\u7a97\u53e3", "\u76ee\u6807 12-17 18:00\uff08\u4e1c\u4e09\u533a\uff09\u524d\u63d0\u4ea4\uff0c\u786c\u622a\u6b62 12-18 01:00 UTC", "\u9ed1\u5ba2\u677e\u65f6\u95f4\u7ebf\uff1b\u7f13\u51b2\u539f\u5219"],
    ["\u5546\u4e1a\u5316", "entitlement \u67b6\u6784\u5148\u884c\uff0c\u4e0d\u63a5\u771f\u5b9e\u652f\u4ed8\u3001\u4e0d\u53d1\u884c\u4ee3\u5e01", "directives PART XV \u5546\u4e1a\u5316\u7ae0\u8282"],
  ],
  [16, 52, 32]));
content.push(tableTitle("\u8868 3-2 \u5f85\u786e\u8ba4\u7684\u5916\u90e8\u4f9d\u8d56\uff08\u9700\u8981\u7528\u6237\u63d0\u4f9b\uff09"));
content.push(dataTable(
  ["\u4f9d\u8d56\u9879", "\u5f71\u54cd\u8303\u56f4", "\u7f3a\u5931\u65f6\u7684\u964d\u7ea7\u65b9\u6848"],
  [
    ["\u3010\u5f85\u786e\u8ba4\uff1a\u751f\u4ea7\u57df\u540d\u4e0e HTTPS \u8bc1\u4e66\u3011", "\u516c\u5f00\u8bbf\u95ee\u5165\u53e3\u4e0e\u53ef\u5d4c\u5165\u7ec4\u4ef6", "\u4f7f\u7528\u53ef\u7528\u6258\u7ba1\u5e73\u53f0\u9ed8\u8ba4\u57df\u540d\uff0c\u8bb0\u5165\u5b9e\u65bd\u62a5\u544a"],
    ["\u3010\u5f85\u786e\u8ba4\uff1a\u4e91\u8d26\u6237 / VPS \u51ed\u8bc1\u3011", "Phase 9 \u751f\u4ea7\u90e8\u7f72", "\u4ea7\u51fa\u7cbe\u786e\u5230\u547d\u4ee4\u7684\u90e8\u7f72\u624b\u518c\u4e0e\u6240\u6709\u8005\u52a8\u4f5c\u6e05\u5355\uff0c\u4e0d\u4f2a\u9020\u90e8\u7f72"],
    ["\u3010\u5f85\u786e\u8ba4\uff1aGitHub OAuth App \u51ed\u8bc1\u3011", "GitHub \u96c6\u6210\u4e0e CI \u6444\u53d6", "\u4ea4\u4ed8\u96c6\u6210\u4ee3\u7801\u4e0e\u914d\u7f6e\u6b65\u9aa4\uff0c\u51ed\u8bc1\u5230\u4f4d\u540e\u4e00\u952e\u542f\u7528"],
    ["\u3010\u5f85\u786e\u8ba4\uff1a\u56e2\u961f\u5206\u5de5\u4e0e\u8d1f\u8d23\u4eba\u3011", "\u8ffd\u8e2a\u8868\u8d1f\u8d23\u4eba\u5217", "\u5148\u6309\u5de5\u4f5c\u6d41\u5206\u6d3e\uff0c\u7528\u6237\u786e\u8ba4\u540e\u66f4\u65b0"],
    ["\u3010\u5f85\u786e\u8ba4\uff1a\u5bf9\u8c61\u5b58\u50a8\u670d\u52a1\uff08MinIO/S3\uff09\u3011", "\u8bc1\u636e\u4e0e\u5de5\u4ef6\u5b58\u50a8", "\u4f7f\u7528\u672c\u5730 MinIO \u9002\u914d\u5668\uff0c\u4fdd\u6301\u63a5\u53e3\u53ef\u66ff\u6362"],
  ],
  [34, 28, 38]));

// Phase 0-12 各节
for (let n = 0; n <= 12; n++) {
  const ph = PHASES[n];
  const tasks = TASKS.filter(t => t.phase === n);
  content.push(h1(`Phase ${n} ${ph.title}\uff08${ph.window}\uff09`));
  content.push(body(ph.goal));
  content.push(tableTitle(`\u8868 ${n + 4}-1 \u4efb\u52a1\u6e05\u5355\uff08${tasks.length} \u9879\uff09`));
  content.push(taskTable(tasks));
  content.push(body(`\u5b8c\u6210\u6807\u51c6\uff1a${ph.dod}`, { after: 160 }));
}

// 十七、附录A：活文档体系与最终质量门
content.push(h1("\u9644\u5f55A\uff1a\u6d3b\u6587\u6863\u4f53\u7cfb\u4e0e\u6700\u7ec8\u8d28\u91cf\u95e8"));
content.push(body("directives \u8981\u6c42\u5168\u7a0b\u7ef4\u62a4\u4e00\u5957\u6d3b\u6587\u6863\u4f53\u7cfb\u5e76\u9010\u9879\u9644\u8bc1\u636e\uff1b\u4e0b\u8868\u5217\u51fa\u5fc5\u987b\u5efa\u7acb\u5e76\u6301\u7eed\u66f4\u65b0\u7684\u5341\u4e8c\u4efd\u6838\u5fc3\u6587\u6863\u3002\u672a\u66f4\u65b0\u7684\u6d3b\u6587\u6863\u89c6\u4e3a\u672a\u5b8c\u6210\u76f8\u5e94\u9636\u6bb5\u3002"));
content.push(tableTitle("\u8868 A-1 \u6d3b\u6587\u6863\u6e05\u5355"));
content.push(dataTable(
  ["\u6587\u4ef6", "\u7528\u9014", "\u5efa\u7acb\u4efb\u52a1"],
  [
    ["docs/implementation/MASTER_EXECUTION_PLAN.md", "\u603b\u6267\u884c\u8ba1\u5212\u4e0e\u4f9d\u8d56\u56fe", "T-002"],
    ["docs/implementation/PROGRESS.md", "\u6bcf\u65e5\u8fdb\u5ea6\u8bb0\u5f55", "T-002"],
    ["docs/implementation/BLOCKERS.md", "\u963b\u585e\u9879\uff1a\u5f71\u54cd\u3001\u6240\u9700\u52a8\u4f5c\u3001\u8d23\u4efb\u4eba\u3001\u671f\u9650", "T-002"],
    ["docs/implementation/DECISIONS.md", "\u67b6\u6784\u4e0e\u4ea7\u54c1\u51b3\u7b56\u8bb0\u5f55", "T-002"],
    ["docs/implementation/VERIFICATION_LOG.md", "\u9a8c\u8bc1\u8bc1\u636e\u65e5\u5fd7\uff08\u622a\u56fe\u3001\u6d4b\u8bd5\u8f93\u51fa\u3001tx \u54c8\u5e0c\uff09", "T-002"],
    ["IMPLEMENTATION_STATUS.md", "\u80fd\u529b\u5b9e\u73b0\u72b6\u6001\u603b\u89c8\uff08\u5982\u5b9e\u5206\u7ea7\uff09", "T-002"],
    ["ARCHITECTURE.md", "\u67b6\u6784\u8bf4\u660e\uff0c\u968f\u5b9e\u73b0\u540c\u6b65", "T-002"],
    ["SECURITY_AUDIT.md", "\u5b89\u5168\u5ba1\u8ba1\u8fc7\u7a0b\u4e0e\u53d1\u73b0", "T-002"],
    ["EDGE_CASES.md", "\u4e0d\u5c11\u4e8e 250 \u6761\u8fb9\u754c\u6761\u4ef6\u77e9\u9635\uff08\u6bcf\u6761 8 \u5b57\u6bb5\uff09", "T-002"],
    ["DEPLOYMENT.md", "\u90e8\u7f72\u624b\u518c\u4e0e Onyx \u5305\u8def\u5f84\u3001\u4ea4\u6613\u54c8\u5e0c", "T-002"],
    ["SUBMISSION_READINESS.md", "\u63d0\u4ea4\u5c31\u7eea\u6838\u67e5\u72b6\u6001", "T-002"],
    ["CHANGELOG.md", "\u53d8\u66f4\u65e5\u5fd7\uff0c\u6bcf\u6b21\u53d1\u5e03\u8ffd\u52a0", "T-002"],
  ],
  [44, 44, 12], { centerCols: [2], boldFirstCol: false }));
content.push(tableTitle("\u8868 A-2 \u6700\u7ec8\u8d28\u91cf\u95e8\uff08directives PART XVI\uff0c\u5168\u90e8\u8fbe\u6807\u624d\u53ef\u63d0\u4ea4\uff09"));
content.push(dataTable(
  ["\u5206\u7ec4", "\u5fc5\u67e5\u9879"],
  [
    ["\u4ea7\u54c1", "\u5bfc\u822a\u5168\u901a\uff1b\u6838\u5fc3\u529f\u80fd\u4e92\u8054\uff1b\u65e0\u6b7b\u6309\u94ae\u4e0e\u5360\u4f4d\u6d41\u7a0b\uff1b\u65e0\u4f2a\u9020\u94fe\u4e0a\u8bb0\u5f55\u4e0e Agent \u6267\u884c\uff1b\u7ec4\u7ec7\u4e0e\u8d26\u6237\u9694\u79bb\u6709\u6548\uff1b\u516c\u5171\u9a8c\u8bc1\u771f\u6b63\u53ef\u7528"],
    ["\u533a\u5757\u94fe", "\u771f\u5b9e Gno \u4ee3\u7801\u4e0e Onyx \u90e8\u7f72\uff1b\u94fe ID \u6b63\u786e\uff1b\u5305\u8def\u5f84\u53ef\u9a8c\u8bc1\uff1b\u5b58\u5728\u6210\u529f\u7684\u72b6\u6001\u53d8\u66f4\u4ea4\u6613\uff1b\u516c\u5f00 realm \u53ef\u8bfb\uff1b\u8de8 realm \u6d4b\u8bd5\u901a\u8fc7"],
    ["\u5de5\u7a0b", "\u5e72\u51c0\u67b6\u6784\u4e0e\u5f3a\u7c7b\u578b\uff1b\u8fc1\u79fb\u53ef\u7528\uff1b\u7d22\u5f15\u5408\u7406\uff1b\u79d8\u5bc6\u5b89\u5168\uff1b\u81ea\u52a8\u5316\u6d4b\u8bd5\u4e0e\u7ed3\u6784\u5316\u65e5\u5fd7\uff1b\u91cd\u8bd5\u4e0e\u6062\u590d\u673a\u5236\uff1b\u65e0\u672a\u89e3\u51b3\u9ad8\u5371\u963b\u585e"],
    ["\u8bbe\u8ba1", "\u5b8c\u6574\u54c1\u724c\u4e0e\u4ee4\u724c\uff1b\u54cd\u5e94\u5f0f\u5e03\u5c40\uff1b3D \u56de\u9000\u4e0e reduced-motion\uff1b\u53ef\u8bbf\u95ee\u4ea4\u4e92\uff1b\u52a0\u8f7d\u4e0e\u5931\u8d25\u72b6\u6001\u9f50\u5168"],
    ["\u63d0\u4ea4", "\u516c\u5f00\u4ed3\u5e93\u4e0e\u53ef\u8bbf\u95ee\u5e94\u7528\uff1bREADME \u4e0e\u67b6\u6784\u6587\u6863\uff1b\u4e0d\u8d85\u4e09\u5206\u949f\u6f14\u793a\u89c6\u9891\uff1b\u63d0\u4ea4\u63cf\u8ff0\uff1b\u547d\u540d\u5408\u89c4\uff1b\u65e0\u5bc6\u94a5\u6cc4\u9732"],
  ],
  [12, 88]));

// 十八、附录B：提交前24小时核对单
content.push(h1("\u9644\u5f55B\uff1a\u63d0\u4ea4\u524d 24 \u5c0f\u65f6\u6838\u5bf9\u5355"));
content.push(body("\u672c\u6838\u5bf9\u5355\u5728\u63d0\u4ea4\u524d 24 \u5c0f\u65f6\uff08\u76ee\u6807 12-16 18:00 \u4e1c\u4e09\u533a\u524d\u542f\u52a8\uff09\u9010\u9879\u6267\u884c\uff0c\u5168\u90e8\u6253\u52fe\u540e\u65b9\u53ef\u63d0\u4ea4\u3002\u4efb\u4f55\u4e00\u9879\u4e0d\u8fbe\u6807\uff0c\u4fee\u590d\u540e\u91cd\u65b0\u6267\u884c\u672c\u5355\u3002\u63d0\u4ea4\u7a97\u53e3\u65f6\u533a\u5bf9\u7167\uff1a\u786c\u622a\u6b62 2026-12-18 01:00 UTC = \u5185\u7f57\u6bd5 12-18 04:00 = \u5317\u4eac 12-18 09:00\uff1b\u76ee\u6807\u63d0\u4ea4\u65f6\u523b\u4e3a 12-17 18:00\uff08\u4e1c\u4e09\u533a\uff09\uff0c\u4e3a\u786c\u622a\u6b62\u7559\u51fa\u5341\u5c0f\u65f6\u7f13\u51b2\u3002"));
content.push(tableTitle("\u8868 B-1 \u63d0\u4ea4\u524d\u6700\u7ec8\u6838\u5bf9\u5355\uff0815 \u9879\uff09"));
content.push(dataTable(
  ["#", "\u6838\u5bf9\u9879", "\u5b8c\u6210"],
  [
    ["1", "\u6d4b\u8bd5\u7f51\u90e8\u7f72\u5728\u7ebf\uff1a\u5e94\u7528\u53ef\u6253\u5f00\uff0cgnoweb \u90e8\u7f72\u9875\u53ef\u8bbf\u95ee\uff0c\u90e8\u7f72\u94fe\u63a5\u5df2\u586b\u5165\u63d0\u4ea4\u8868\u5355", "\u25a1"],
    ["2", "\u516c\u5f00\u4ed3\u5e93\u53ef\u533f\u540d\u8bbf\u95ee\uff1aLICENSE\u3001SECURITY.md\u3001README \u9f50\u5907\uff0c\u65e0\u5bc6\u94a5\u4e0e\u5185\u90e8\u94fe\u63a5", "\u25a1"],
    ["3", "\u771f\u5b9e Gno \u7ec4\u4ef6\uff1arealm \u5305\u8def\u5f84\u4e0e\u4ea4\u6613\u54c8\u5e0c\u5728 README \u4e2d\u53ef\u67e5\u9a8c", "\u25a1"],
    ["4", "\u6f14\u793a\u89c6\u9891\u53ef\u76f4\u94fe\u64ad\u653e\uff0c\u65f6\u957f\u4e0d\u8d85\u4e09\u5206\u949f\uff0c\u4e03\u6bb5\u5206\u955c\u5b8c\u6574", "\u25a1"],
    ["5", "\u9879\u76ee\u63cf\u8ff0\u4e0e\u529f\u80fd\u6e05\u5355\u5982\u5b9e\uff0c\u65e0\u5938\u5927\u4e0e\u672a\u9a8c\u8bc1\u58f0\u660e", "\u25a1"],
    ["6", "\u9879\u76ee\u540d PROOFLOOM \u5408\u89c4\u590d\u67e5\uff1a\u65e0 Gno \u524d\u7f00\u3001\u65e0\u5b98\u65b9\u5173\u8054\u6697\u793a", "\u25a1"],
    ["7", "\u65b0\u4f1a\u8bdd\u7aef\u5230\u7aef\u6f14\u793a\u8def\u5f84\u5b8c\u6574\u8d70\u901a\uff08\u8fde\u94b1\u5305\u2192\u5efa\u9879\u2192\u53d1\u8bc1\u636e\u2192\u4e0a\u94fe\u2192\u516c\u5171\u9a8c\u8bc1\uff09", "\u25a1"],
    ["8", "\u6f14\u793a\u8d26\u6237\u4e0e\u6d4b\u8bd5\u6570\u636e\u5c31\u7eea\uff0c\u6c34\u9f99\u5934\u4f59\u989d\u8db3\u591f", "\u25a1"],
    ["9", "\u6240\u6709\u622a\u56fe\u4e0e\u94fe\u63a5\u6709\u6548\uff1bDoraHacks \u5404\u5b57\u6bb5\u4e0e\u6750\u6599\u4e00\u81f4", "\u25a1"],
    ["10", "\u6d88\u6781\u60c5\u5f62\u6392\u67e5\uff1a\u975e\u7eaf\u8bbe\u8ba1\u7a3f\u3001\u975e\u672a\u90e8\u7f72\u4ee3\u7801\u3001\u975e\u6279\u91cf\u751f\u6210\u6761\u76ee", "\u25a1"],
    ["11", "\u7b2c\u4e09\u65b9\u7ec4\u4ef6\u8bb8\u53ef\u8bc1\u5408\u89c4\u4e14\u5df2\u7f72\u540d\uff1b\u539f\u521b\u6027\u58f0\u660e\u786e\u8ba4", "\u25a1"],
    ["12", "\u90e8\u7f72\u5b58\u6d3b\u76d1\u63a7\u5c31\u7eea\uff1a\u8bc4\u5ba1\u671f\uff0812-18 \u81f3 21\uff09\u94fe\u63a5\u6301\u7eed\u53ef\u8bbf\u95ee", "\u25a1"],
    ["13", "testnet \u91cd\u7f6e\u5e94\u6025\u9884\u6848\u53ef\u6267\u884c\uff08\u5feb\u901f\u91cd\u90e8\u7f72\u811a\u672c\u5df2\u6f14\u7ec3\uff09", "\u25a1"],
    ["14", "\u83b7\u5956\u540e\u6750\u6599\u9884\u5907\uff1aKYC \u8eab\u4efd\u6750\u6599\u3001GNOT \u6536\u6b3e\u94b1\u5305\u5730\u5740", "\u25a1"],
    ["15", "\u63d0\u4ea4\u8bb0\u5f55\u7559\u5b58\uff1a\u63d0\u4ea4\u540e\u533f\u540d\u6d4f\u89c8\u5668\u590d\u6838\u5c55\u793a\u9875\u5168\u90e8\u5b57\u6bb5", "\u25a1"],
  ],
  [6, 82, 12], { centerCols: [0, 2] }));
content.push(body("\u63d0\u4ea4\u5b8c\u6210\u540e\uff0c\u9879\u76ee\u8fdb\u5165 Phase 12 \u8fd0\u8425\u8282\u594f\uff1a12-21 \u5173\u6ce8\u83b7\u5956\u516c\u793a\u5e76\u4e8e 12-22 \u524d\u5b8c\u6210 KYC\uff1b\u968f\u540e\u6309\u6708\u63a8\u8fdb Retention \u8def\u7ebf\uff0c\u5e76\u4ee5\u8ffd\u8e2a\u8868\u4e2d Retention KPI \u5de5\u4f5c\u8868\u9010\u9879\u5bf9\u6807\u771f\u5b9e\u7528\u91cf\u3002\u672c\u6e05\u5355\u4e0e\u8ffd\u8e2a\u8868\u4fdd\u6301\u540c\u6b65\u66f4\u65b0\uff0c\u76f4\u81f3 M6 \u68c0\u67e5\u70b9\u7ed3\u675f\u3002"));

// ── 页眉/页脚 ──
function pageFooter() {
  return new Footer({ children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: P.secondary,
      font: { ascii: "Times New Roman", eastAsia: "SimSun" } })],
  })] });
}
function pageHeader() {
  return new Header({ children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: P.innerLine, space: 4 } },
    children: [new TextRun({ text: "PROOFLOOM \u603b\u63a7\u6267\u884c\u6e05\u5355", size: 16, color: P.secondary,
      font: { ascii: "Times New Roman", eastAsia: "SimSun" } })],
  })] });
}

// ── 组装文档 ──
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  creator: "Z.ai",
  title: "PROOFLOOM \u603b\u63a7\u6267\u884c\u6e05\u5355",
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimSun" }, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 30, bold: true, color: P.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 26, bold: true, color: P.primary },
        paragraph: { spacing: { before: 240, after: 120, line: 312 }, outlineLevel: 1 },
      },
    },
  },
  sections: [
    { // 封面：边距 0，无页码
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR4({
        title: "PROOFLOOM \u603b\u63a7\u6267\u884c\u6e05\u5355",
        subtitle: "\u5546\u7528\u7ea7\u4ea7\u54c1\u5f00\u53d1 \u00d7 Gnome Tavern \u9ed1\u5ba2\u677e\u63d0\u4ea4\uff08Gno.land Onyx \u00d7 DoraHacks\uff09",
        englishLabel: "MASTER EXECUTION DO-LIST",
        metaLines: [
          "\u4ea7\u54c1\uff1aPROOFLOOM \u2014 \u53bb\u4e2d\u5fc3\u5316\u8f6f\u4ef6\u6eaf\u6e90\u4e0e AI Agent \u95ee\u8d23\u5e73\u53f0",
          "\u6bd4\u8d5b\uff1aGnome Tavern Hackathon by Gno.land\uff08\u5956\u91d1\u6c60 $40,000 GNOT\uff09",
          "\u622a\u6b62\uff1a2026-12-18 01:00 UTC\uff08\u5185\u90e8\u51bb\u7ed3 12-17\uff09",
          "\u89c4\u6a21\uff1a13 \u4e2a\u9636\u6bb5 \u00b7 119 \u9879\u4efb\u52a1 \u00b7 \u7248\u672c v1.0 \u00b7 2026-11-27",
        ],
        footerLeft: "PROOFLOOM \u00b7 The architecture of trust, made visible",
        footerRight: "Gno.land \u00d7 DoraHacks",
        palette: GO1,
      }),
    },
    { // 目录：罗马页码
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin,
          pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "\u76ee  \u5f55", bold: true, size: 32,
            font: { eastAsia: "SimHei", ascii: "Times New Roman" }, color: P.primary })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "\u6ce8\uff1a\u672c\u76ee\u5f55\u7531\u57df\u4ee3\u7801\u751f\u6210\u3002\u5982\u7f16\u8f91\u540e\u9875\u7801\u53d1\u751f\u53d8\u5316\uff0c\u8bf7\u5728\u76ee\u5f55\u4e0a\u53f3\u952e\u9009\u62e9\u66f4\u65b0\u57df\u4ee5\u5237\u65b0\u9875\u7801\u3002",
            italics: true, size: 18, color: "888888",
            font: { ascii: "Times New Roman", eastAsia: "SimSun" } })],
        }),
      ],
    },
    { // 正文：阿拉伯页码从 1 起
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin,
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: pageHeader() },
      footers: { default: pageFooter() },
      children: content,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("saved:", OUT, buf.length, "bytes");
});
