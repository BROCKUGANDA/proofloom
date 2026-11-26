// docx_lib.js — 封面配方 R4（Top Color Block）+ GO-1 调色板 + 布局工具（来自 docx skill design-system.md）
const {
  Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, ShadingType, TableLayoutType,
} = require("docx");

// ── GO-1 Graphite Orange（proposal/plan 路由默认调色板）──
const GO1 = {
  bg: "1A2330", primary: "FFFFFF", accent: "D4875A",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "D4875A", headerText: "FFFFFF", accentLine: "D4875A", innerLine: "DDD0C8", surface: "F8F0EB" },
};

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

function emptyPara() { return new Paragraph({ children: [] }); }

function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1], nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
          /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) breakAt -= 1;
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}

function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

// ── Recipe R4: Top Color Block（outer 16838 wrapper + 上部深色块 + 强调分隔条 + 下部白区）──
function buildCoverR4(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 26);
  const titleSize = titlePt * 2;

  const titleBlockHeight = titleLines.length * (titlePt * 23 + 200);
  const englishLabelH = config.englishLabel ? (9 * 23 + 500) : 0;
  const subtitleH = config.subtitle ? (12 * 23 + 200) : 0;
  const upperContentH = englishLabelH + titleBlockHeight + subtitleH;
  const UPPER_MIN = 7500;
  const UPPER_H = Math.max(UPPER_MIN, upperContentH + 1500 + 800);
  const DIVIDER_H = 60;

  const contentEstimate = englishLabelH + titleBlockHeight + subtitleH;
  const spacerIntrinsic = 280;
  const topSpacing = Math.max(UPPER_H - contentEstimate - spacerIntrinsic - 800, 400);

  const upperBlock = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: UPPER_H, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        verticalAlign: "top",
        margins: { left: padL, right: padR },
        children: [
          new Paragraph({ spacing: { before: topSpacing } }),
          config.englishLabel ? new Paragraph({
            spacing: { after: 500 },
            children: [new TextRun({ text: config.englishLabel.split("").join(" "),
              size: 18, color: P.accent, font: { ascii: "Calibri" }, characterSpacing: 60 })],
          }) : null,
          ...titleLines.map((line, i) => new Paragraph({
            spacing: { after: i < titleLines.length - 1 ? 100 : 200, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
            children: [new TextRun({ text: line, size: titleSize, bold: true,
              color: P.cover.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })],
          })),
          config.subtitle ? new Paragraph({
            spacing: { after: 100 },
            children: [new TextRun({ text: config.subtitle, size: 24, color: P.cover.subtitleColor,
              font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
          }) : null,
        ].filter(Boolean),
      })],
    })],
  });

  const divider = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: DIVIDER_H, rule: "exact" },
      children: [new TableCell({ borders: noBorders,
        shading: { type: ShadingType.CLEAR, fill: P.accent }, children: [emptyPara()] })],
    })],
  });

  const lowerContent = [
    new Paragraph({ spacing: { before: 800 } }),
    ...(config.metaLines || []).map(line => new Paragraph({
      indent: { left: padL }, spacing: { after: 100 },
      children: [new TextRun({ text: line, size: 28, color: "3A4550",
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    })),
    new Paragraph({ spacing: { before: 2000 } }),
    new Paragraph({
      indent: { left: padL },
      children: [
        new TextRun({ text: config.footerLeft || "", size: 22, color: "909090" }),
        new TextRun({ text: "          " }),
        new TextRun({ text: config.footerRight || "", size: 22, color: "909090" }),
      ],
    }),
  ];

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: "FFFFFF" }, borders: noBorders,
        verticalAlign: "top",
        children: [upperBlock, divider, ...lowerContent],
      })],
    })],
  })];
}

module.exports = { GO1, NB, noBorders, allNoBorders, emptyPara, calcTitleLayout, splitTitleLines, buildCoverR4 };
