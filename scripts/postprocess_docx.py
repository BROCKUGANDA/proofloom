# -*- coding: utf-8 -*-
"""docx 后处理（WPS 兼容）：
1. 按节区映射页脚文件，为 PAGE 域加显式格式开关（目录节 ROMAN，正文节 arabic）
2. 移除封面节空 <w:pgNumType/>
"""
import re, sys, zipfile, shutil, os

path = sys.argv[1]
tmp = path + ".tmp"
shutil.copy(path, tmp)

with zipfile.ZipFile(tmp, "r") as zin:
    names = zin.namelist()
    contents = {n: zin.read(n) for n in names}

docxml = contents["word/document.xml"].decode("utf-8")
rels = contents["word/_rels/document.xml.rels"].decode("utf-8")

# rId -> footer 文件
rel_map = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels))

# 逐节区：找 sectPr 中的 pgNumType fmt 与 footerReference
sect_blocks = re.findall(r"<w:sectPr[^>]*>.*?</w:sectPr>", docxml, re.S)
footer_fmt = {}  # footer 文件名 -> 'ROMAN' | 'arabic'
for blk in sect_blocks:
    fmt_m = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', blk)
    refs = re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', blk)
    if not refs:
        continue
    fmt = fmt_m.group(1) if fmt_m else ""
    word_switch = "ROMAN" if "roman" in fmt.lower() else "arabic"
    for rid in refs:
        target = rel_map.get(rid, "")
        fname = "word/" + target.lstrip("/") if not target.startswith("word/") else target
        footer_fmt[fname] = word_switch

changed = []
for name in names:
    if re.match(r"word/footer\d*\.xml$", name):
        xml = contents[name].decode("utf-8")
        if re.search(r"<w:instrText[^>]*>[^<]*PAGE[^<]*</w:instrText>", xml):
            switch = footer_fmt.get(name, "arabic")
            new_xml, n1 = re.subn(
                r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
                rf"\1 PAGE \\* {switch} \\* MERGEFORMAT \2", xml)
            if n1:
                contents[name] = new_xml.encode("utf-8")
                changed.append(f"{name}: PAGE -> PAGE \\* {switch} x{n1}")

# 清除空 pgNumType（封面节）
docxml2, n2 = re.subn(r"<w:pgNumType/>", "", docxml)
if n2:
    contents["word/document.xml"] = docxml2.encode("utf-8")
    changed.append(f"document.xml: removed {n2} empty pgNumType")

with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        zout.writestr(n, contents[n])
os.remove(tmp)
print("patched:", path)
for c in changed:
    print(" -", c)
