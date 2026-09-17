import sys; sys.path.insert(0,'.')
from glyph import shape
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import re
F="node_modules/@fontsource/reem-kufi/files/reem-kufi-arabic-700-normal.woff2"
NAVY="#16244A"; TEAL="#12A39B"; TEAL_D="#0B7A75"; AMBER="#F0A53A"; WHITE="#FFFFFF"

def bbox_of(d):
    nums=list(map(float,re.findall(r'-?\d+\.?\d*',d)))
    xs=nums[0::2]; ys=nums[1::2]
    return min(xs),min(ys),max(xs),max(ys)

meem,_,_,_=shape(F,"م"); mb=shape.bounds
word,ww,_,_=shape(F,"مدار"); wb=shape.bounds


def placed(d,b,cx,cy,h):
    s=h/(b[3]-b[1]); w=(b[2]-b[0])*s
    tx=cx-w/2-b[0]*s; ty=cy-h/2-b[1]*s
    return f'<path d="{d}" transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f})"', w

def mark_inner(planet, orbit, back_orbit, cut, sat=AMBER, simple=False):
    CX,CY,RX,RY,ROT = 256,318,214,58,-14
    g=f'transform="rotate({ROT} {CX} {CY})"'
    sw = 30 if simple else 18
    p,w=placed(meem,mb,256,236,232)
    import itertools
    mark_inner.n = getattr(mark_inner,'n',0)+1
    mid=f"m{mark_inner.n}"
    x0=256-w/2; y0=236-116
    mask=f'<mask id="{mid}"><rect x="-100" y="-100" width="800" height="800" fill="#fff"/><rect x="{x0-8:.1f}" y="{y0-8:.1f}" width="{w+16:.1f}" height="248" fill="#000"/></mask>'

    back = f'<path d="M {CX-RX} {CY} A {RX} {RY} 0 0 1 {CX+RX} {CY}" fill="none" stroke="{back_orbit}" stroke-width="{sw}" stroke-linecap="round" {g} mask="url(#{mid})"/>'
    front_cut = f'<path d="M {CX+RX} {CY} A {RX} {RY} 0 0 1 {CX-RX} {CY}" fill="none" stroke="{cut}" stroke-width="{sw+22}" {g}/>'
    front = f'<path d="M {CX+RX} {CY} A {RX} {RY} 0 0 1 {CX-RX} {CY}" fill="none" stroke="{orbit}" stroke-width="{sw}" stroke-linecap="round" {g}/>'
    # القمر على الجهة اليمنى العليا من المدار
    import math
    t=math.radians(-28); x=CX+RX*math.cos(t); y=CY+RY*math.sin(t)
    r=math.radians(ROT); sx=CX+(x-CX)*math.cos(r)-(y-CY)*math.sin(r); sy=CY+(x-CX)*math.sin(r)+(y-CY)*math.cos(r)
    moon = f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="{38 if simple else 28}" fill="{sat}" stroke="{cut}" stroke-width="10"/>'
    return "\n".join([mask, back, p+f' fill="{planet}"/>', front_cut, front, moon])

def icon(size=512, maskable=False, simple=False):
    pad = 'transform="translate(56 56) scale(.78)"' if maskable else ""
    rx = 0 if maskable else 112
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">
<title>مدار MIDAR</title>
<rect width="512" height="512" rx="{rx}" fill="{NAVY}"/>
<g {pad}>{mark_inner(WHITE, TEAL, "#2E6F83", NAVY, simple=simple)}</g>
</svg>'''

def mark_on_light():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="24 96 464 330"><title>مدار</title>{mark_inner(NAVY, TEAL_D, "#9FCFCB", "#FFFFFF")}</svg>'''
def mark_on_dark():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="24 96 464 330"><title>مدار</title>{mark_inner(WHITE, "#5FD3CB", "#3F7F92", NAVY)}</svg>'''

def lockup(dark=False):
    # الشعار الكامل: الأيقونة يمين + كلمة مدار + MIDAR
    fg = WHITE if dark else NAVY
    sub = "#AFC0D6" if dark else "#5F6B7A"
    inner = mark_inner(WHITE, "#5FD3CB", "#3F7F92", NAVY) if dark else mark_inner(NAVY, TEAL_D, "#9FCFCB", "#FFFFFF")
    wp,w = placed(word,wb,0,0,120)
    W = 40 + w + 30 + 300
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} 220"><title>مدار MIDAR</title>
<g transform="translate({W-300:.0f} 0) scale(.62) translate(-30 -60)">{inner}</g>
<g transform="translate({40 + w/2:.1f} 98)">{wp} fill="{fg}"/></g>
<text x="{40 + w/2:.1f}" y="196" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" letter-spacing="14" fill="{sub}">MIDAR</text>
</svg>'''

import os
os.makedirs("out",exist_ok=True)
open("out/icon.svg","w").write(icon())
open("out/icon-maskable.svg","w").write(icon(maskable=True))
open("out/favicon.svg","w").write(icon(simple=True))
open("out/mark.svg","w").write(mark_on_light())
open("out/mark-light.svg","w").write(mark_on_dark())
open("out/logo.svg","w").write(lockup())
open("out/logo-light.svg","w").write(lockup(dark=True))
