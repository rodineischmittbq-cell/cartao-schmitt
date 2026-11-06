# Gera as imagens do cartão no Google Wallet: hero-0..12 (carimbos) e hero-premio
from PIL import Image, ImageDraw, ImageFilter
W,H=1032,336; S=2  # desenha em 2x e reduz (bordas suaves)
AZ1=(11,127,174); AZ2=(8,59,85); OURO1=(240,181,82); OURO2=(184,114,26)
def fundo(c1,c2):
    im=Image.new('RGB',(W*S,H*S)); px=im.load()
    d=ImageDraw.Draw(im)
    for y in range(H*S):
        for x in range(0,W*S,4):
            t=min(1,(x/(W*S))*0.6+(y/(H*S))*0.6)
            col=tuple(int(c1[i]+(c2[i]-c1[i])*t) for i in range(3))
            d.line([(x,y),(x+3,y)],fill=col)
    lay=Image.new('RGBA',im.size,(0,0,0,0)); dl=ImageDraw.Draw(lay)
    for x in range(0,W*S,10): dl.line([(x,0),(x,H*S)],fill=(255,255,255,20),width=3)
    im=im.convert('RGBA'); im.alpha_composite(lay); return im
def prato(d,cx,cy,r,cor,w):
    # garfo
    x=cx-r*0.32
    for dx in (-0.14,0,0.14): d.line([(x+dx*r,cy-r*0.55),(x+dx*r,cy-r*0.2)],fill=cor,width=w)
    d.arc([x-r*0.14,cy-r*0.36,x+r*0.14,cy-r*0.04],0,180,fill=cor,width=w)
    d.line([(x,cy-r*0.08),(x,cy+r*0.55)],fill=cor,width=w)
    # faca
    k=cx+r*0.3
    d.line([(k,cy-r*0.55),(k,cy+r*0.55)],fill=cor,width=w)
    d.polygon([(k,cy-r*0.55),(k+r*0.2,cy-r*0.25),(k+r*0.2,cy+r*0.05),(k,cy+r*0.05)],fill=cor)
def estrela(d,cx,cy,r,cor):
    import math
    pts=[]
    for i in range(10):
        a=-math.pi/2+i*math.pi/5; rr=r if i%2==0 else r*0.45
        pts.append((cx+rr*math.cos(a),cy+rr*math.sin(a)))
    d.polygon(pts,fill=cor)
def tracejado(d,cx,cy,r,cor,w):
    import math
    for i in range(24):
        a0=i*15; d.arc([cx-r,cy-r,cx+r,cy+r],a0,a0+8,fill=cor,width=w)
def gerar(n,premio=False):
    im=fundo(OURO1,OURO2) if premio else fundo(AZ1,AZ2)
    d=ImageDraw.Draw(im)
    cols,rows=6,2; r=46*S; gy=26*S; mx=110*S; gapx=(W*S-2*mx)/(cols-1); y0=(H*S-(4*r+gy))/2
    for i in range(12):
        cx=mx+(i%cols)*gapx; cy=y0+r+(i//cols)*(2*r+gy)
        on=premio or i<n
        if on:
            sh=Image.new('RGBA',im.size,(0,0,0,0)); ds=ImageDraw.Draw(sh)
            ds.ellipse([cx-r,cy-r+5*S,cx+r,cy+r+5*S],fill=(0,0,0,70)); sh=sh.filter(ImageFilter.GaussianBlur(6*S)); im.alpha_composite(sh)
            d=ImageDraw.Draw(im)
            d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=(255,250,240) if premio else (255,255,255))
            if premio and i==11: estrela(d,cx,cy,r*0.62,OURO2)
            else: prato(d,cx,cy,r,(138,82,8) if premio else AZ2,int(5*S))
        elif i==11:
            d.ellipse([cx-r,cy-r,cx+r,cy+r],outline=(232,163,61),width=int(4*S)); estrela(d,cx,cy,r*0.5,(232,163,61))
        else:
            tracejado(d,cx,cy,r,(255,255,255,150),int(3*S))
    im=im.resize((W,H),Image.LANCZOS).convert('RGB')
    return im
for n in range(13): gerar(n).save(f'hero-{n}.png',optimize=True)
gerar(12,premio=True).save('hero-premio.png',optimize=True)
