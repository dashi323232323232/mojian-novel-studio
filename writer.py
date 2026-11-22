#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小说写作助手：每章写作前先维护一份硬盘上的"上下文文件"（故事圣经），
保证人物性格、伏笔、时间线在几十章之后仍然一致。

用法:
  python writer.py new   <项目名> --title 书名 --genre 火影同人
  python writer.py write <项目名> --hint "本章：鸣人第一次见自来也" [--words 3000]
  python writer.py holes <项目名>          # 看未回收伏笔
  python writer.py prompt <项目名>         # 只看本章将喂给模型的上下文（不生成）

接口: LM Studio / llama-server 的 OpenAI 兼容端点，默认 http://127.0.0.1:1234/v1
环境变量: NOVEL_API  NOVEL_MODEL  NOVEL_KEY
"""
import os, sys, json, time, argparse, re, urllib.request

API = os.environ.get('NOVEL_API', 'http://127.0.0.1:1234/v1')
MODEL = os.environ.get('NOVEL_MODEL', 'local-model')
KEY = os.environ.get('NOVEL_KEY', 'sk-local')
ROOT = os.path.dirname(os.path.abspath(__file__))
CTX_NAME = '上下文.md'

TPL = """# 《{title}》故事上下文

> 这是模型的长期记忆。每次写作前自动读取，写完后自动更新。
> 规则：只增不删；被推翻的设定划删除线并注明原因。

## 一、核心设定
- 题材：{genre}
- 世界/时代：
- 主角：姓名 / 身份 / 目标 / 金手指
- 核心矛盾：
- 剧情主线终点（作者心里的结局）：

## 二、人物卡

### 主角
- 姓名：
- 性格特点：三个词 + 一句解释
- 说话风格：（口头禅、用词习惯、怎么称呼别人）
- 底线 / 雷点：
- 当前实力 / 处境：

## 三、未回收伏笔

| 编号 | 埋设章节 | 内容 | 计划回收 |
|---|---|---|---|
| F0 | - | （示例行，可删） | - |

## 四、章节摘要

## 五、时间线与当前进度
- 当前章节：0
- 故事内时间：
- 当前所在地：
- 上一章结尾的状态：

## 六、文风约束
- 人称视角：第三人称限知（贴主角）
- 段落节奏：短句为主，对话推动情节
- 禁止：现代网络用语、翻译腔、总结式收尾
- 每章字数：{words} 字左右
"""


def ctx_path(proj):
    return os.path.join(ROOT, proj, CTX_NAME)


def read_ctx(proj):
    p = ctx_path(proj)
    if not os.path.exists(p):
        sys.exit('没有找到上下文文件: %s\n先跑: python writer.py new %s' % (p, proj))
    return open(p, encoding='utf-8').read()


def write_ctx(proj, text):
    p = ctx_path(proj)
    tmp = p + '.tmp'
    open(tmp, 'w', encoding='utf-8').write(text)
    os.replace(tmp, p)


def section(ctx, name):
    out, on = [], False
    for ln in ctx.splitlines():
        if ln.startswith('## '):
            on = name in ln
            continue
        if on:
            out.append(ln)
    return '\n'.join(out).strip()


def chat(messages, max_tokens=4000, temp=0.85):
    body = json.dumps({'model': MODEL, 'messages': messages, 'max_tokens': max_tokens,
                       'temperature': temp, 'top_p': 0.9, 'stream': False}).encode()
    req = urllib.request.Request(API.rstrip('/') + '/chat/completions', data=body,
                                 headers={'Content-Type': 'application/json',
                                          'Authorization': 'Bearer ' + KEY})
    r = json.load(urllib.request.urlopen(req, timeout=1800))
    return r['choices'][0]['message']['content']


def build_prompt(proj, hint, words, recent=3):
    ctx = read_ctx(proj)
    core = section(ctx, '核心设定')
    chars = section(ctx, '人物卡')
    holes = section(ctx, '未回收伏笔')
    tl = section(ctx, '时间线与当前进度')
    style = section(ctx, '文风约束')
    summ = section(ctx, '章节摘要')
    chs = [b for b in summ.split('### 第') if b.strip()]
    keep = chs[-recent:]
    summ_recent = '\n'.join('### 第' + b for b in keep) if keep else '（还没有已写章节）'
    sys_msg = ('你是一位正在写长篇网络小说（番茄风格）的作者。必须严格遵守下面的故事上下文，'
               '人物性格、称呼、伏笔、时间线都不能自相矛盾。\n\n'
               '【核心设定】\n' + core +
               '\n\n【人物卡】\n' + chars +
               '\n\n【未回收伏笔】\n' + holes +
               '\n\n【最近几章摘要】\n' + summ_recent +
               '\n\n【时间线与当前进度】\n' + tl +
               '\n\n【文风约束】\n' + style +
               '\n\n写作要求：只输出正文，不要章节标题、不要任何说明或总结。')
    user = ('请写下一章，严格控制在 %d–%d 字之间（目标 %d 字），写完后自然收尾，不要仓促结束。%s'
            % (int(words * 0.85), int(words * 1.15), words, ('本章要点：' + hint) if hint else ''))
    return sys_msg, user


def cur_chapter(proj):
    tl = section(read_ctx(proj), '时间线与当前进度')
    for ln in tl.splitlines():
        if '当前章节' in ln:
            d = ''.join(c for c in ln if c.isdigit())
            return int(d) if d else 0
    return 0


def trim_to_sentence(text, marks='。！？…”）'):
    """截到最后一个完整句子，避免被 max_tokens 切在半句上。"""
    if not text:
        return text
    if text[-1] in marks:
        return text
    cut = max(text.rfind(c) for c in marks)
    return text[:cut + 1] if cut > len(text) * 0.6 else text


def insert_section(ctx, heading, block):
    """把 block 插到指定 ## 小节的末尾（下一个 ## 之前），而不是文件尾。"""
    i = ctx.find(heading)
    if i < 0:
        return ctx.rstrip() + '\n\n' + block
    j = ctx.find('\n## ', i + 1)
    if j < 0:
        return ctx.rstrip() + '\n' + block
    head = ctx[:i + len(heading)]
    body = ctx[i + len(heading):j].rstrip()
    return head + body + '\n\n' + block.rstrip() + '\n' + ctx[j:]


def insert_after_table(ctx, heading, rows):
    """把行插到该小节内最后一个表格行之后。"""
    i = ctx.find(heading)
    if i < 0:
        return ctx.rstrip() + '\n' + rows
    j = ctx.find('\n## ', i + 1)
    seg = ctx[i:j if j > 0 else len(ctx)]
    lines = seg.split('\n')
    last = None
    for k, ln in enumerate(lines):
        if ln.strip().startswith('|'):
            last = k
    if last is None:
        return ctx
    lines.insert(last + 1, rows.rstrip())
    return ctx[:i] + '\n'.join(lines) + ctx[(j if j > 0 else len(ctx)):]


def cmd_new(a):
    d = os.path.join(ROOT, a.name)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, CTX_NAME)
    if os.path.exists(p):
        print('已存在:', p)
        return
    open(p, 'w', encoding='utf-8').write(TPL.format(title=a.title or a.name, genre=a.genre or '', words=a.words))
    print('已创建:', p)
    print('先填好 核心设定 / 人物卡 / 伏笔 三节，再跑 write。')


def cmd_prompt(a):
    s, u = build_prompt(a.name, a.hint, a.words)
    print('===== SYSTEM (%d 字) =====\n%s\n\n===== USER =====\n%s' % (len(s), s, u))


def cmd_holes(a):
    print(section(read_ctx(a.name), '未回收伏笔'))


def cmd_write(a):
    sys_msg, user = build_prompt(a.name, a.hint, a.words)
    print('[1/3] 生成正文...', flush=True)
    t0 = time.time()
    cap = min(a.tokens, int(a.words / 1.45) + 60)      # 中文约 1.45 字/token
    txt = chat([{'role': 'system', 'content': sys_msg}, {'role': 'user', 'content': user}], max_tokens=cap).strip()
    txt = trim_to_sentence(txt)
    print('      %d 字，%.0f 秒' % (len(txt), time.time() - t0), flush=True)

    n = cur_chapter(a.name) + 1
    out_dir = os.path.join(ROOT, a.name, '正文')
    os.makedirs(out_dir, exist_ok=True)
    fn = os.path.join(out_dir, '第%03d章.txt' % n)
    open(fn, 'w', encoding='utf-8').write(txt)
    print('[2/3] 正文已存:', fn, flush=True)

    print('[3/3] 让模型写本章摘要 + 新伏笔...', flush=True)
    meta = chat([
        {'role': 'system', 'content': '你是小说编辑助手，只输出 JSON，不要解释。'},
        {'role': 'user', 'content':
            '下面是刚写完的第 %d 章正文。请输出 JSON：\n'
            '{"title":"本章标题(8字内)","summary":"一句话概要(40字内)",'
            '"events":"2-3个关键事件,分号隔开","chars":"出场人物,逗号隔开",'
            '"new_holes":["新埋的伏笔,没有就空数组"],"state":"结尾主角处境(30字内)",'
            '"time":"故事内时间点(15字内)","place":"当前所在地"}\n\n正文：\n%s' % (n, txt[:6000])}],
        max_tokens=600, temp=0.3)
    js = meta.strip()
    tick = chr(96) * 3
    if tick in js:
        js = js.split(tick)[1]
    s0, s1 = js.find('{'), js.rfind('}')
    try:
        m = json.loads(js[s0:s1 + 1])
    except Exception:
        m = {'title': '', 'summary': txt[:40], 'events': '', 'chars': '', 'new_holes': [],
             'state': '', 'time': '', 'place': ''}

    ctx = read_ctx(a.name)
    holes = m.get('new_holes') or []
    entry = ('### 第%d章 %s\n- 一句话概要：%s\n- 关键事件：%s\n- 出场人物：%s\n- 新增伏笔：%s\n'
             % (n, m.get('title', ''), m.get('summary', ''), m.get('events', ''),
                m.get('chars', ''), '；'.join(holes) or '无'))
    ctx = insert_section(ctx, '## 四、章节摘要', entry)
    if holes:
        rows = ''.join('| F%d-%d | 第%d章 | %s | 待定 |\n' % (n, i + 1, n, h) for i, h in enumerate(holes))
        ctx = insert_after_table(ctx, '## 三、未回收伏笔', rows)
    ctx = re.sub(r'- 当前章节：\d+', '- 当前章节：%d' % n, ctx)
    if m.get('time'):  ctx = re.sub(r'- 故事内时间：.*', '- 故事内时间：' + m['time'], ctx)
    if m.get('place'): ctx = re.sub(r'- 当前所在地：.*', '- 当前所在地：' + m['place'], ctx)
    if m.get('state'): ctx = re.sub(r'- 上一章结尾的状态：.*', '- 上一章结尾的状态：' + m['state'], ctx)
    write_ctx(a.name, ctx)
    print('上下文已更新：第%d章，新增伏笔 %d 条' % (n, len(holes)))
    print('\n===== 正文预览（前 300 字）=====\n' + txt[:300])


p = argparse.ArgumentParser()
sub = p.add_subparsers(dest='cmd', required=True)
a1 = sub.add_parser('new');   a1.add_argument('name'); a1.add_argument('--title', default=''); a1.add_argument('--genre', default=''); a1.add_argument('--words', type=int, default=3000); a1.set_defaults(f=cmd_new)
a2 = sub.add_parser('write'); a2.add_argument('name'); a2.add_argument('--hint', default=''); a2.add_argument('--words', type=int, default=3000); a2.add_argument('--tokens', type=int, default=4000); a2.set_defaults(f=cmd_write)
a3 = sub.add_parser('prompt');a3.add_argument('name'); a3.add_argument('--hint', default=''); a3.add_argument('--words', type=int, default=3000); a3.set_defaults(f=cmd_prompt)
a4 = sub.add_parser('holes'); a4.add_argument('name'); a4.set_defaults(f=cmd_holes)
args = p.parse_args()
args.f(args)
