# -*- coding: utf-8 -*-
"""修复 TOC 首条目重复：移除 TOC 域段落中 separate 之后的 hyperlink 首条目占位
（保留其后 18 条带页码的纯文本条目；字段更新时 Word 会重新生成全部条目）"""
import re, sys, zipfile, shutil, os

path = sys.argv[1]
tmp = path + ".tmp"
shutil.copy(path, tmp)

with zipfile.ZipFile(tmp, "r") as zin:
    names = zin.namelist()
    contents = {n: zin.read(n) for n in names}

xml = contents["word/document.xml"].decode("utf-8")

# 定位 TOC 域段：begin ... separate 后紧跟的 <w:hyperlink>...</w:hyperlink>
pattern = re.compile(
    r'(<w:fldChar w:fldCharType="separate"/></w:r>)<w:hyperlink [^>]*>.*?</w:hyperlink>',
    re.S)
xml2, n = pattern.subn(r"\1", xml)
if n == 0:
    print("no hyperlink first-entry found; nothing changed")
else:
    contents["word/document.xml"] = xml2.encode("utf-8")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in names:
            zout.writestr(name, contents[name])
    print(f"removed {n} duplicate TOC hyperlink entry")

os.remove(tmp)
