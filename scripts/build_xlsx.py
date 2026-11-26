# -*- coding: utf-8 -*-
"""生成 PROOFLOOM 执行追踪表.xlsx（6 个工作表）— 遵循 xlsx skill design.md/base.py 规范"""
import json, os, sys, math

XLSX_SKILL_DIR = "/home/z/my-project/skills/xlsx"
for sub in [XLSX_SKILL_DIR, os.path.join(XLSX_SKILL_DIR, "templates")]:
    if sub not in sys.path:
        sys.path.insert(0, sub)
from base import *  # noqa
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = "/home/z/my-project/download/PROOFLOOM执行追踪表.xlsx"

with open(os.path.join(HERE, "tasks.json"), encoding="utf-8") as f:
    DATA = json.load(f)
PHASES = {p["num"]: p for p in DATA["phases"]}
TASKS = DATA["tasks"]

wb = Workbook()


def write_table(ws, title, headers, rows, col_types, widths, notes=None,
                wrap_cols=(), center_cols=(), tall_base=22):
    """按设计系统写一张表：B2 标题、4 行表头、5 行起数据、备注在末尾+2。col_types: text/center/int"""
    last_col = len(headers) + 1
    setup_sheet(ws, title=title, last_col=last_col)
    for ci, h in enumerate(headers, start=2):
        ws.cell(row=4, column=ci, value=h)
    style_header_row(ws, 4, 2, last_col)
    r = 5
    for i, row in enumerate(rows):
        for ci, v in enumerate(row, start=2):
            ws.cell(row=r, column=ci, value=v)
        style_data_row(ws, r, 2, last_col, i)
        for ci in range(2, last_col + 1):
            cell = ws.cell(row=r, column=ci)
            head = headers[ci - 2]
            wrap = head in wrap_cols
            center = head in center_cols
            cell.alignment = Alignment(
                horizontal="center" if center else "left",
                vertical="top" if wrap else "center",
                wrap_text=wrap,
            )
        # 行高按换行列最长文本估算
        max_lines = 1
        for head in wrap_cols:
            ci = headers.index(head) + 2
            v = str(ws.cell(row=r, column=ci).value or "")
            w = widths.get(head, 20)
            max_lines = max(max_lines, math.ceil(max(1, len(v)) / max(8, w / 2.0)))
        ws.row_dimensions[r].height = max(tall_base, max_lines * 14 + 8)
        r += 1
    last_data = r - 1
    # 列宽
    ws.column_dimensions["A"].width = COLUMN_WIDTHS["margin"]
    for ci, h in enumerate(headers, start=2):
        ws.column_dimensions[get_column_letter(ci)].width = widths.get(h, 14)
    if notes:
        nr = last_data + 2
        for note in notes:
            ws.cell(row=nr, column=2, value=note).font = font_caption()
            nr += 1
    return last_data


# ══════════ Sheet 1 总任务表 ══════════
ws = wb.active
ws.title = "总任务表"
headers1 = ["任务ID", "阶段", "阶段名称", "任务", "说明与验收标准", "优先级", "建议完成日", "依赖", "状态", "负责人"]
rows1 = [[t["id"], t["phase"], PHASES[t["phase"]]["title"], t["title"], t["detail"],
          t["priority"], t["due"], t["deps"] or "—", "未开始", "待分配"] for t in TASKS]
widths1 = {"任务ID": 9, "阶段": 6, "阶段名称": 15, "任务": 26, "说明与验收标准": 40,
           "优先级": 7, "建议完成日": 10, "依赖": 9, "状态": 8, "负责人": 8}
n_p0 = sum(1 for t in TASKS if t["priority"] == "P0")
n_p1 = sum(1 for t in TASKS if t["priority"] == "P1")
n_p2 = sum(1 for t in TASKS if t["priority"] == "P2")
last1 = write_table(ws, "PROOFLOOM 总控执行追踪表（Gnome Tavern 黑客松 · 截止 2026-12-18 01:00 UTC）",
                    headers1, rows1, {}, widths1,
                    wrap_cols=("任务", "说明与验收标准"), center_cols=("任务ID", "阶段", "优先级", "建议完成日", "状态", "负责人"),
                    tall_base=24)
ws.freeze_panes = "C5"
ws.auto_filter.ref = f"B4:K{last1}"
dv = DataValidation(type="list", formula1='"未开始,进行中,已完成,受阻"', allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"J5:J{last1}")
ws.conditional_formatting.add(f"G5:G{last1}",
    CellIsRule(operator="equal", formula=['"P0"'], font=Font(name=FONT_NAME, color=ACCENT_NEGATIVE, bold=True)))
ws.conditional_formatting.add(f"J5:J{last1}",
    CellIsRule(operator="equal", formula=['"已完成"'], font=Font(name=FONT_NAME, color=ACCENT_POSITIVE),
               fill=PatternFill(bgColor="E8F5E9")))
ws.conditional_formatting.add(f"J5:J{last1}",
    CellIsRule(operator="equal", formula=['"受阻"'], font=Font(name=FONT_NAME, color=ACCENT_NEGATIVE),
               fill=PatternFill(bgColor="FDEDEC")))
ws.conditional_formatting.add(f"J5:J{last1}",
    CellIsRule(operator="equal", formula=['"进行中"'], font=Font(name=FONT_NAME, color=ACCENT_WARNING),
               fill=PatternFill(bgColor="FEF9E7")))
# 统计块（活公式）
sr = last1 + 2
stats = [("P0（提交必需）任务数", f'=COUNTIF(G5:G{last1},"P0")'),
         ("P1（商用完善）任务数", f'=COUNTIF(G5:G{last1},"P1")'),
         ("P2（赛后增强）任务数", f'=COUNTIF(G5:G{last1},"P2")'),
         ("已完成任务数", f'=COUNTIF(J5:J{last1},"已完成")')]
for i, (label, formula) in enumerate(stats):
    ws.cell(row=sr + i, column=2, value=label).font = font_caption()
    c = ws.cell(row=sr + i, column=3, value=formula)
    c.font = font_caption()
    c.alignment = Alignment(horizontal="left")

# ══════════ Sheet 2 关键日期 ══════════
ws2 = wb.create_sheet("关键日期")
rows2 = [
    ["2026-11-23 01:00", "提交开放（已开放）", "11-23 04:00", "11-23 09:00", "DoraHacks Submit Build 入口可用"],
    ["2026-11-27", "本清单启动（D0）", "—", "—", "侦察、注册、环境准备开始"],
    ["2026-11-28", "Phase 0-1 完成线", "—", "—", "仓库审计、工具链、注册合规、核心规格初稿"],
    ["2026-11-30", "架构与设计规格定稿", "—", "—", "七份核心规格 + Realm 规格冻结"],
    ["2026-12-05", "Realm 本地演练完成", "—", "—", "gnodev 端到端闭环、测试全绿"],
    ["2026-12-06", "Onyx 真实部署完成", "—", "—", "包路径与交易哈希记录入 DEPLOYMENT.md"],
    ["2026-12-09", "核心产品域贯通", "—", "—", "身份/项目/组件/发布/证据/验证端到端"],
    ["2026-12-12", "全量界面与状态完备", "—", "—", "三环境全部页面 + 19 类状态"],
    ["2026-12-13", "250+ 边界矩阵完成", "—", "—", "EDGE_CASES.md 达标"],
    ["2026-12-15", "部署验收与实施报告", "—", "—", "全新会话端到端验收 + 15 项事实报告"],
    ["2026-12-16", "提交材料齐备", "—", "—", "README、视频、截图、描述文案"],
    ["2026-12-17", "内部冻结 · 目标提交 18:00 (UTC+3)", "12-17 18:00 前提交", "12-17 23:00 前", "为硬截止留缓冲"],
    ["2026-12-18 01:00 UTC", "提交硬截止", "12-18 04:00", "12-18 09:00", "此后不再接受提交"],
    ["2026-12-18 至 12-21", "评审期", "—", "—", "Gno.land 团队按四项标准评分"],
    ["2026-12-21", "获奖公示并联系", "—", "—", "准备 KYC"],
    ["2026-12-22", "KYC 截止", "—", "—", "逾期延迟派奖"],
    ["2026-12-23 至 12-24", "奖金派发（GNOT）", "—", "—", "或等值 USDC（合规需要时）"],
    ["2027-03-21", "Retention M3 检查点", "—", "—", "表单+真实用量（50 地址/500 交易/20 月活）"],
    ["2027-06-21", "Retention M6 检查点", "—", "—", "100 地址/1500 交易/50 月活/社区 500"],
]
write_table(ws2, "关键日期与时间线（含三时区对照）",
            ["时间 (UTC)", "事件", "内罗毕 (UTC+3)", "北京 (UTC+8)", "说明"],
            rows2, {}, {"时间 (UTC)": 20, "事件": 30, "内罗毕 (UTC+3)": 18, "北京 (UTC+8)": 12, "说明": 40},
            wrap_cols=("事件", "说明"), center_cols=("时间 (UTC)", "内罗毕 (UTC+3)", "北京 (UTC+8)"),
            tall_base=24)

# ══════════ Sheet 3 提交合规清单 ══════════
ws3 = wb.create_sheet("提交合规清单")
rows3 = [
    ["Gno.land 测试网实时部署 + 部署链接", "硬性要求", "A live deployment on the Gno.land testnet, with the deployment link", "T-110", "待核验", ""],
    ["公开代码仓库", "硬性要求", "A public code repository", "T-106", "待核验", ""],
    ["真实 Gno 组件（realm 或 package）", "硬性要求", "A genuine Gno component, such as a realm or package", "T-040", "待核验", ""],
    ["README 说明项目用途与使用方法", "硬性要求", "A README that explains what the project does and how to use it", "T-101", "待核验", ""],
    ["演示视频展示项目运行", "硬性要求", "A demo video showing the project working", "T-103", "待核验", ""],
    ["简短项目描述", "硬性要求", "A short description of what your project does", "T-105", "待核验", ""],
    ["非纯设计稿/幻灯/概念", "不合格排除", "Not eligible: design mockups, slides, or concepts only", "T-109", "待核验", ""],
    ["代码已部署（非仅本地实现）", "不合格排除", "Not eligible: code that is not deployed", "T-109", "待核验", ""],
    ["具备真实 Gno 组件", "不合格排除", "Not eligible: projects without a real Gno component", "T-109", "待核验", ""],
    ["非重复/复制/批量生成条目", "不合格排除", "Not eligible: duplicate, copied, or mass generated entries", "T-109", "待核验", ""],
    ["项目命名无 Gno 前缀、无官方关联暗示", "命名规则", "Project names cannot use the Gno prefix or branding implying official connection; may be disqualified", "T-010", "待核验", ""],
    ["原创作品；开源组件许可证允许且已署名", "原创性", "Submissions must be your own work; open source libraries allowed if licenses permit and credited", "T-106", "待核验", ""],
    ["提交时项目在测试网可运行", "时效规则", "Projects must be deployed and working on the Gno.land testnet at the time you submit", "T-110", "待核验", ""],
    ["每项目仅一次提交；团队可提交多个不同项目", "提交规则", "Each project may be submitted only once; a team may submit more than one distinct project", "T-107", "待核验", ""],
    ["年满 18 周岁且非受制裁地区；可假名参赛", "资格规则", "Participants must be at least 18; pseudonymous builders can submit", "T-112", "待核验", ""],
    ["保留全部所有权；无股权/IP 转让/排他", "权益规则", "You keep full ownership of your work. No equity, no IP assignment, no exclusivity", "—", "已确认", ""],
    ["获奖者 12/22 前完成 KYC；30 天内提供钱包地址", "获奖流程", "Winners must complete KYC; provide Gno.land wallet address within 30 days", "T-112", "待核验", ""],
    ["知悉评分权重：技术 40% / 用户吸引 20% / 创意 20% / 文档与演示 20%", "评审标准", "Technical quality 40%, user appeal 20%, creativity 20%, docs and demo 20%", "T-105", "已确认", ""],
    ["Retention 用量排除团队出资钱包；操纵用量将取消资格", "Retention 红线", "Team funded and newly created wallets do not count toward usage; manipulating usage numbers = disqualification", "T-116", "已确认", ""],
    ["全部提交材料在截止后保持可访问", "时效规则", "提交后到评审结束（12/18-12/21）部署与视频链接必须持续在线", "T-110", "待核验", ""],
]
last3 = write_table(ws3, "DoraHacks 提交合规清单（依据已核实的黑客松页面）",
                    ["检查项", "类别", "要求依据（页面原文要点）", "对应任务", "状态", "证据/链接"],
                    rows3, {}, {"检查项": 30, "类别": 10, "要求依据（页面原文要点）": 44, "对应任务": 9, "状态": 8, "证据/链接": 16},
                    wrap_cols=("检查项", "要求依据（页面原文要点）"), center_cols=("类别", "对应任务", "状态"),
                    tall_base=24)
dv3 = DataValidation(type="list", formula1='"待核验,通过,不通过"', allow_blank=True)
ws3.add_data_validation(dv3)
dv3.add(f"F5:F{last3}")
ws3.conditional_formatting.add(f"F5:F{last3}",
    CellIsRule(operator="equal", formula=['"通过"'], font=Font(name=FONT_NAME, color=ACCENT_POSITIVE),
               fill=PatternFill(bgColor="E8F5E9")))
ws3.conditional_formatting.add(f"F5:F{last3}",
    CellIsRule(operator="equal", formula=['"不通过"'], font=Font(name=FONT_NAME, color=ACCENT_NEGATIVE),
               fill=PatternFill(bgColor="FDEDEC")))

# ══════════ Sheet 4 Retention KPI ══════════
ws4 = wb.create_sheet("Retention KPI")
rows4 = [
    ["Realm 在主网存活", "检查点时主网可用", "检查点时主网可用", "0", "未达标", "主网部署需先通过安全评审门"],
    ["每月发布或主网部署", "≥1 次/月", "≥1 次/月", "0", "未达标", "以 GitHub Release 与部署记录为证"],
    ["检查点表单提交", "M3 提交（部署链接+demo+用量）", "M6 提交", "—", "未达标", "主办方在 M3/M6 发放表单"],
    ["独立参与地址数", "50", "100", "0", "未达标", "团队出资与新创钱包不计入"],
    ["调用项目 realm 的交易数", "500", "1500", "0", "未达标", "真实用户交易"],
    ["月活地址数", "20", "50", "0", "未达标", "按月统计"],
    ["被其他项目导入/使用", "≥1 个项目", "保持并有增势", "0", "未达标", "消费者示例转化为真实集成"],
    ["社区规模（X+TG+Discord 成员合计）", "200", "500", "0", "未达标", "含黑客松期间积累"],
    ["公开项目更新频率", "≥2 次/月", "≥2 次/月", "0", "未达标", "X/Discord/博客可查"],
]
write_table(ws4, "Builder Retention Prize 指标追踪（M3/M6 检查点标准，非保证获奖）",
            ["指标", "M3 目标（2027-03-21）", "M6 目标（2027-06-21）", "当前值", "达标状态", "备注"],
            rows4, {}, {"指标": 30, "M3 目标（2027-03-21）": 24, "M6 目标（2027-06-21）": 16, "当前值": 8, "达标状态": 9, "备注": 30},
            wrap_cols=("指标", "M3 目标（2027-03-21）", "备注"), center_cols=("当前值", "达标状态"),
            tall_base=24)

# ══════════ Sheet 5 活文档清单 ══════════
ws5 = wb.create_sheet("活文档清单")
rows5 = [
    ["docs/implementation/MASTER_EXECUTION_PLAN.md", "总执行计划与依赖图", "随阶段推进更新", "T-002"],
    ["docs/implementation/PROGRESS.md", "进度记录", "每日", "T-002"],
    ["docs/implementation/BLOCKERS.md", "阻塞项：影响、所需动作、责任人、期限", "发现即记", "T-002"],
    ["docs/implementation/DECISIONS.md", "架构与产品决策记录", "决策即记", "T-002"],
    ["docs/implementation/VERIFICATION_LOG.md", "验证证据日志（截图/测试输出/tx 哈希）", "每项验证即记", "T-002"],
    ["IMPLEMENTATION_STATUS.md", "实现状态总览（每项能力如实分级）", "每阶段末", "T-002"],
    ["ARCHITECTURE.md", "架构说明", "架构变更时", "T-002"],
    ["SECURITY_AUDIT.md", "安全审计与发现", "安全工作后", "T-002"],
    ["EDGE_CASES.md", "≥250 条边界条件矩阵（8 字段/条）", "Phase 8", "T-002"],
    ["DEPLOYMENT.md", "部署手册与 Onyx 包路径/tx 哈希", "每次部署", "T-002"],
    ["SUBMISSION_READINESS.md", "提交就绪状态", "Phase 10-11", "T-002"],
    ["CHANGELOG.md", "变更日志", "每次发布", "T-002"],
]
write_table(ws5, "活文档体系（directives 要求持续维护、逐项附证据）",
            ["文件", "用途", "更新要求", "建立任务"],
            rows5, {}, {"文件": 44, "用途": 34, "更新要求": 14, "建立任务": 9},
            wrap_cols=("文件", "用途"), center_cols=("更新要求", "建立任务"), tall_base=24)

# ══════════ Sheet 6 资源链接 ══════════
ws6 = wb.create_sheet("资源链接")
rows6 = [
    ["Gno.land 官方文档", "https://docs.gno.land", "协议与工具链权威参考"],
    ["Getting Started", "https://docs.gno.land/builders/getting-started", "入门指南"],
    ["网络配置（链 ID 与 RPC）", "https://docs.gno.land/resources/gnoland-networks", "部署前核对 onyx-1 端点"],
    ["测试网水龙头", "https://faucet.gno.land", "领取测试 GNOT"],
    ["gnodev 本地开发", "https://docs.gno.land/resources/gnodev", "本地 realm 演练"],
    ["Gno Playground", "https://play.gno.land", "在线试验 Gno 代码"],
    ["Build with AI (gnomcp)", "https://mcp.gno.dev", "可选 Agent 集成（WIP，仅适配器）"],
    ["Adena 钱包", "https://adena.app", "钱包集成对象"],
    ["GnoScan 区块探索器", "https://gnoscan.io", "验证交易与 realm 页面"],
    ["GnoSwap DEX", "https://gnoswap.io", "生态参考"],
    ["Gno.land GitHub", "https://github.com/gnolang/gno", "源码与标准库"],
    ["Awesome Gno", "https://github.com/gnoverse/awesome-gno", "生态项目索引"],
    ["Gno.land Discord", "https://discord.gg/gnoland", "#gnome-tavern-hackathon 频道答疑"],
    ["Gno.land X", "https://twitter.com/_gnoland", "官方公告"],
    ["DoraHacks 黑客松页面", "https://dorahacks.io/hackathon/gnome-tavern/detail", "规则与提交入口（以页面最新公示为准）"],
]
write_table(ws6, "官方资源与链接（2026-11-27 核实）",
            ["名称", "URL", "用途"],
            rows6, {}, {"名称": 26, "URL": 44, "用途": 36},
            wrap_cols=("用途",), center_cols=(), tall_base=22)

wb.properties.creator = "Z.ai"
os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print("saved:", OUT)
