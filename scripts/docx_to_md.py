import sys, zipfile, re, os, glob
import xml.etree.ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def text_of(p):
    out=[]
    for n in p.iter():
        if n.tag==W+'t': out.append(n.text or '')
        elif n.tag==W+'tab': out.append(' ')
        elif n.tag==W+'br': out.append('\n')
    return ''.join(out)
def para(p, numbering_levels=None):
    st=p.find(f'{W}pPr/{W}pStyle')
    style=st.get(W+'val') if st is not None else ''
    t=text_of(p).strip()
    if not t: return ''
    m=re.match(r'Heading(\d)',style or '')
    if m: return '#'*int(m.group(1))+' '+t
    if style=='Title': return '# '+t
    num=p.find(f'{W}pPr/{W}numPr')
    if num is not None:
        il=num.find(W+'ilvl'); lvl=int(il.get(W+'val')) if il is not None else 0
        return '  '*lvl+'- '+t
    return t
def table(tbl):
    rows=[]
    for tr in tbl.findall(W+'tr'):
        cells=[]
        for tc in tr.findall(W+'tc'):
            cells.append(' / '.join(x for x in (text_of(p).strip() for p in tc.iter(W+'p')) if x).replace('|','\\|'))
        rows.append(cells)
    if not rows: return ''
    w=max(len(r) for r in rows)
    rows=[r+['']*(w-len(r)) for r in rows]
    md=['| '+' | '.join(rows[0])+' |','|'+'---|'*w]+['| '+' | '.join(r)+' |' for r in rows[1:]]
    return '\n'.join(md)
def convert(path):
    z=zipfile.ZipFile(path); root=ET.fromstring(z.read('word/document.xml'))
    body=root.find(W+'body'); out=[]
    for el in body:
        if el.tag==W+'p':
            s=para(el)
            if s: out.append(s)
        elif el.tag==W+'tbl':
            out.append(table(el))
    return '\n\n'.join(out)
src, dst = sys.argv[1], sys.argv[2]
for f in sorted(glob.glob(src+'/*.docx')):
    md=convert(f); name=os.path.basename(f)[:-5]
    open(os.path.join(dst,name+'.md'),'w').write(md)
    print(f"{len(md):>8}  {name}")
