import uharfbuzz as hb, sys, io
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
def load(path):
    f=TTFont(path); b=io.BytesIO(); f.flavor=None; f.save(b); return f, b.getvalue()
def shape(path, text, features=None):
    tt, data = load(path)
    face=hb.Face(data); font=hb.Font(face)
    buf=hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, features or {})
    gs=tt.getGlyphSet(); order=tt.getGlyphOrder()
    x=0; parts=[]; B=None
    # الإزاحات تأتي بترتيب بصري (من اليسار لليمين) في harfbuzz للنصوص RTL
    for info,pos in zip(buf.glyph_infos, buf.glyph_positions):
        name=order[info.codepoint]
        pen=SVGPathPen(gs)
        tp=TransformPen(pen,(1,0,0,-1,x+pos.x_offset,-pos.y_offset))
        gs[name].draw(tp)
        bp=BoundsPen(gs); gs[name].draw(TransformPen(bp,(1,0,0,-1,x+pos.x_offset,-pos.y_offset)))
        if bp.bounds:
            b=bp.bounds; B=[min(B[0],b[0]),min(B[1],b[1]),max(B[2],b[2]),max(B[3],b[3])] if B else list(b)
        parts.append(pen.getCommands()); x+=pos.x_advance
    upm=tt['head'].unitsPerEm
    shape.bounds=B
    return " ".join(parts), x, upm, tt
if __name__=="__main__":
    d,w,upm,tt=shape(sys.argv[1], sys.argv[2])
    print(w,upm, tt['hhea'].ascent, tt['hhea'].descent)

def glyphs(path, text):
    """يعيد كل حرف كمسار منفصل مع حدوده"""
    tt, data = load(path)
    from fontTools.pens.boundsPen import BoundsPen
    face=hb.Face(data); font=hb.Font(face)
    buf=hb.Buffer(); buf.add_str(text); buf.guess_segment_properties(); hb.shape(font, buf, {})
    gs=tt.getGlyphSet(); order=tt.getGlyphOrder(); x=0; out=[]
    for info,pos in zip(buf.glyph_infos, buf.glyph_positions):
        name=order[info.codepoint]
        pen=SVGPathPen(gs); tp=TransformPen(pen,(1,0,0,-1,x+pos.x_offset,-pos.y_offset)); gs[name].draw(tp)
        bp=BoundsPen(gs); gs[name].draw(bp); b=bp.bounds
        bb=(b[0]+x, -b[3], b[2]+x, -b[1]) if b else None
        out.append((name, pen.getCommands(), bb)); x+=pos.x_advance
    return out, x
