import html
W,H=1900,1100
SYM="#d35b5b"; WIRE="#5fae82"; TXT="#555555"; FRAME="#e08a8a"; TAGC="#7a9a88"
items=[]
def line(pts,c=SYM,w=1.1): items.append(('line',pts,c,w))
def wire(*pts): line(list(pts),WIRE,1.0)
def rect(x,y,w,h,fill="none",stroke=SYM,sw=1.1): items.append(('rect',x,y,w,h,fill,stroke,sw))
def text(x,y,s,size=9,anchor="start",bold=False,color=TXT): items.append(('text',x,y,s,size,anchor,bold,color))
def dot(x,y,r=2.4,c=WIRE): items.append(('circ',x,y,r,c,c))
def poly(pts,c=SYM,fill="none"): items.append(('poly',pts,c,fill))
def T(pt,x,y,rot):
    px,py=pt
    return (x+px,y+py) if rot==0 else (x-py,y+px)
def tx(x,y,rot,*pts): return [T(p,x,y,rot) for p in pts]

# ---------- symbols ----------
def res(x,y,rot,ref,val,L=60,side=1):
    a=(L-30)/2; z=[(a+i*5,(-5 if i%2==0 else 5)) for i in range(1,6)]
    line(tx(x,y,rot,(0,0),(a,0),*z,(a+30,0),(L,0)))
    cx,cy=T((L/2,0),x,y,rot)
    if rot==0: text(cx,cy-12,ref,9,"middle"); text(cx,cy+13,val,9,"middle")
    else:
        an="start" if side>0 else "end"; text(cx+11*side,cy-5,ref,9,an); text(cx+11*side,cy+7,val,9,an)
def cap(x,y,rot,ref,val,pol=False,L=60,side=1):
    m=L/2
    line(tx(x,y,rot,(0,0),(m-3,0))); line(tx(x,y,rot,(m+3,0),(L,0)))
    line(tx(x,y,rot,(m-3,-10),(m-3,10))); line(tx(x,y,rot,(m+3,-10),(m+3,10)))
    cx,cy=T((m,0),x,y,rot)
    if pol: px,py=T((m-11,-11),x,y,rot); text(px,py,"+",10,"middle")
    an="start" if side>0 else "end"; text(cx+14*side,cy-5,ref,9,an); text(cx+14*side,cy+7,val,9,an)
def led(x,y,ref):
    line([(x,y),(x+20,y)]); poly([(x+20,y-8),(x+20,y+8),(x+40,y)]); line([(x+40,y-8),(x+40,y+8)]); line([(x+40,y),(x+60,y)])
    line([(x+25,y-11),(x+32,y-18)]); line([(x+33,y-11),(x+40,y-18)])
    text(x+30,y+20,ref,9,"middle")
def npn(x,y,ref,val):
    line([(x,y),(x+20,y)]); line([(x+20,y-14),(x+20,y+14)])
    line([(x+20,y-6),(x+40,y-18),(x+40,y-30)]); line([(x+20,y+6),(x+40,y+18),(x+40,y+30)]); line([(x+34,y+22),(x+40,y+18),(x+33,y+15)])
    text(x+50,y-4,ref,9); text(x+50,y+8,val,9)
def pmos(x,y,ref,val):
    line([(x,y),(x+18,y)]); line([(x+18,y-14),(x+18,y+14)])
    for a,b in ((-14,-8),(-4,4),(8,14)): line([(x+25,y+a),(x+25,y+b)])
    line([(x+25,y-11),(x+46,y-11),(x+46,y-30)]); line([(x+25,y+11),(x+46,y+11),(x+46,y+30)]); line([(x+25,y),(x+46,y),(x+46,y+11)])
    line([(x+35,y-4),(x+25,y),(x+35,y+4)])
    text(x+56,y-4,ref,9); text(x+56,y+8,val,9)
def cell(x,y):
    line([(x,y),(x,y+11)]); line([(x-10,y+11),(x+10,y+11)]); line([(x-6,y+17),(x+6,y+17)],SYM,2.6); line([(x,y+17),(x,y+30)])
    text(x-13,y+8,"+",9,"end")
def buzzer(x,y,ref,val):
    line([(x,y),(x,y+14)]); line([(x,y+46),(x,y+60)])
    items.append(('circ',x,y+30,16,"none",SYM)); text(x,y+29,"+",10,"middle")
    text(x+22,y+24,ref,9); text(x+22,y+36,val,9)
def rail_up(x,y,name):
    line([(x,y),(x,y-14)],WIRE,1.0); poly([(x-4,y-8),(x+4,y-8),(x,y-14)],WIRE,WIRE); text(x,y-23,name,9,"middle",False,TXT)
def gnd_down(x,y,name="GND"):
    line([(x,y),(x,y+14)],WIRE,1.0); poly([(x-4,y+8),(x+4,y+8),(x,y+14)],WIRE,WIRE); text(x,y+24,name,9,"middle",False,TXT)
TAGX=1740
def tag(y,name):
    w=len(name)*5.6+20
    poly([(TAGX,y-6),(TAGX+w-8,y-6),(TAGX+w,y),(TAGX+w-8,y+6),(TAGX,y+6)],TAGC,"#ffffff")
    text(TAGX+6,y,name,8,"start",False,TXT)
def mod(x,y,w,h,ref,title,top=[],bottom=[]):
    rect(x,y,w,h,"#ffffff",SYM,1.1); text(x,y-8,ref,9); text(x+w/2,y+h/2,title,8,"middle",False,TXT)
    o={}
    for nm,k,dx in top:
        line([(x+dx,y),(x+dx,y-14)]); text(x+dx,y+9,nm,8,"middle"); o[k]=(x+dx,y-14)
    for nm,k,dx in bottom:
        line([(x+dx,y+h),(x+dx,y+h+14)]); text(x+dx,y+h-9,nm,8,"middle"); o[k]=(x+dx,y+h+14)
    return o
def ic(x,y,w,ref,title,left=[],right=[],pitch=30,top=30,stub=30,fs=9):
    n=max(len(left),len(right)); h=top+pitch*(n-1)+top
    rect(x,y,w,h,"#ffffff",SYM,1.1); text(x,y-8,ref,9); text(x+w/2,y+h+11,title,8,"middle")
    out={}
    for i,(nm,key) in enumerate(left):
        py=y+top+pitch*i; line([(x-stub,py),(x,py)]); text(x+4,py,nm,fs); out[key]=(x-stub,py)
    for i,(nm,key) in enumerate(right):
        py=y+top+pitch*i; line([(x+w,py),(x+w+stub,py)]); text(x+w-4,py,nm,fs,"end"); out[key]=(x+w+stub,py)
    return out
def bus(y,name,xs,tagname=None):
    wire((min(xs),y),(TAGX,y)); tag(y,tagname or name)
    for x in xs: dot(x,y)
    text(min(xs)+4,y-5,name,8,"start",False,"#3a8a63") if False else None

# ---------- frame ----------
rect(15,15,W-30,H-30,"none",FRAME,1.3); rect(55,50,W-110,H-100,"none",FRAME,1.0)
cw=(W-110)/6
for i in range(6):
    cx=55+cw*(i+0.5); text(cx,32,str(i+1),11,"middle",False,FRAME); text(cx,H-32,str(i+1),11,"middle",False,FRAME)
    if i: 
        x=55+cw*i; line([(x,15),(x,50)],FRAME,1.0); line([(x,H-50),(x,H-15)],FRAME,1.0)
rh=(H-100)/5
for i in range(5):
    cy=50+rh*(i+0.5); L="ABCDE"[i]; text(35,cy,L,11,"middle",False,FRAME); text(W-35,cy,L,11,"middle",False,FRAME)
    if i: y=50+rh*i; line([(15,y),(55,y)],FRAME,1.0); line([(W-55,y),(W-15,y)],FRAME,1.0)
# title block
bx,by,bw,bh=1330,1002,520,48
rect(bx,by,bw,bh,"#ffffff",FRAME,1.1); line([(bx,by+24),(bx+bw,by+24)],FRAME,1.0); line([(bx+360,by+24),(bx+360,by+bh)],FRAME,1.0)
text(bx+10,by+12,"Title:   IoT Fire Detection Node (AgapSense)",11,"start",False,"#444"); 
text(bx+10,by+36,"Date:   10/2/2026",10,"start",False,"#444"); text(bx+370,by+36,"Sheet:   1/1",10,"start",False,"#444")
text(75,H-62,"Pin map from firmware/agapsense-firmware/src/config.example.h",10,"start",False,"#c05050")

# ================= TOP BAND =================
Y5,Y33=95,115
wire((110,Y5),(TAGX,Y5)); tag(Y5,"+5V"); wire((110,Y33),(TAGX,Y33)); tag(Y33,"+3V3")
rail_up(1180,Y5,"+5V"); rail_up(1300,Y33,"+3V3")
TB={n:310+12*i for i,n in enumerate(["GPS_RX","GPS_TX","SIM_TXD","SIM_RXD","ONEWIRE","MQ7_PWM","MQ7_AO","LED_Y","LED_R","LED_B","BUZZER","GND"])}
drops={n:[] for n in TB}
def d(net,x,y0):  # vertical drop from y0 to bus
    wire((x,y0),(x,TB[net])); drops[net].append(x)
def up(x,y0,rail):
    wire((x,y0),(x,rail)); dot(x,rail)
G=mod(110,170,120,70,"U2","GY-GPS6MV2 (NEO-6M)",top=[("VCC","vcc",60)],bottom=[("RX","rx",20),("TX","tx",60),("GND","gnd",100)])
up(*G['vcc'],Y33); d("GPS_RX",*G['rx']); d("GPS_TX",*G['tx']); d("GND",*G['gnd'])
S=mod(270,170,120,70,"U3","SIM800L EVB",top=[("VCC","vcc",60)],bottom=[("GND","gnd",20),("TXD","txd",60),("RXD","rxd",100)])
up(*S['vcc'],Y5); d("GND",*S['gnd']); d("SIM_TXD",*S['txd']); d("SIM_RXD",*S['rxd'])
cap(430,150,90,"C1","1000µF",pol=True); up(430,150,Y5); d("GND",430,210)
D=mod(560,170,100,70,"U4","DS18B20",top=[("VDD","vdd",50)],bottom=[("DQ","dq",30),("GND","gnd",70)])
up(*D['vdd'],Y33); d("ONEWIRE",*D['dq']); d("GND",*D['gnd'])
res(530,150,90,"R3","4.7k",side=-1); up(530,150,Y33); d("ONEWIRE",530,210)
# MQ-7 driver
M=mod(930,170,100,70,"U5","MQ-7 module",top=[("VCC","vcc",20)],bottom=[("AO","ao",30),("GND","gnd",70)])
pmos(810,180,"Q1","P-MOSFET"); up(856,150,Y5)
wire((856,210),(900,210),(900,156),M['vcc'][0:2] if False else (950,156))
npn(750,260,"Q2","NPN"); wire((790,230),(790,180)); dot(790,180); wire((790,180),(810,180))
res(790,120,90,"R4","10k",side=-1); up(790,120,Y5)
res(690,260,0,"R5","1k"); wire((750,260),(750,260)); wire((750,260),(750,260))
d("MQ7_PWM",690,260); d("GND",790,290)
d("MQ7_AO",*M['ao']); d("GND",*M['gnd'])
# indicators
def chain(x0,net,ref,name):
    yc=235; wire((x0,TB[net]),(x0,yc)); drops[net].append(x0)
    res(x0,yc,0,"R"+ref,"220",L=50); wire((x0+50,yc),(x0+55,yc)); led(x0+55,yc,"D"+ref+" "+name)
    d("GND",x0+125,yc); wire((x0+115,yc),(x0+125,yc))
chain(1070,"LED_Y","6","Yellow"); chain(1220,"LED_R","7","Red"); chain(1370,"LED_B","8","Blue")
buzzer(1570,235,"BZ1","Buzzer"); wire((1550,TB["BUZZER"]),(1550,235),(1570,235)); drops["BUZZER"].append(1550); d("GND",1570,295)
for n,y in TB.items():
    if n=="GND": continue
    bus(y,n,drops[n])
bus(TB["GND"],"GND",drops["GND"]+[1000]); gnd_down(1650,TB["GND"])
text(1060,150,"Tags at the right edge with the same name are the same net.",9,"start",False,"#888")
text(1060,164,"MQ-7: Q1/Q2 PWM-switch the 5 V heater supply (28 % duty ≈ 1.4 V measure).",9,"start",False,"#888")

# ================= BOTTOM BAND =================
Y5b,Y33b=500,520
wire((110,Y5b),(TAGX,Y5b)); tag(Y5b,"+5V"); wire((95,Y33b),(TAGX,Y33b)); tag(Y33b,"+3V3")
rail_up(1560,Y5b,"+5V"); rail_up(1620,Y33b,"+3V3")
BB={n:830+12*i for i,n in enumerate(["GPS_TX","GPS_RX","SIM_TXD","SIM_RXD","ONEWIRE","MQ7_AO","MQ7_PWM","LED_Y","LED_R","LED_B","BUZZER","BATT_SENSE","GND"])}
bd={n:[] for n in BB}
R=[("IO16 (RX2)","GPS_TX"),("IO17 (TX2)","GPS_RX"),("IO26 (RX1)","SIM_TXD"),("IO27 (TX1)","SIM_RXD"),("IO4","ONEWIRE"),("IO34 (ADC1)","MQ7_AO"),("IO25 (PWM)","MQ7_PWM"),("IO14","LED_Y"),("IO12","LED_R"),("IO13","LED_B"),("IO32","BUZZER")]
E=ic(140,560,170,"U1","ESP32 DevKit V1",left=[("VIN","vin"),("3V3","v33"),("GND","gnd"),("IO35 (ADC1)","io35")],right=[(a,k) for a,k in R],pitch=18,top=30)
# right pins to buses (lane order: top pin = rightmost lane, no crossings)
for k,(nm,net) in enumerate(R):
    x1,y1=E[net] if False else (340,590+18*k); lane=360+12*(10-k); wire((x1,y1),(lane,y1),(lane,BB[net])); bd[net].append(lane)
# left pins
x,y=E['vin']; wire((x,y),(x,Y5b)); dot(x,Y5b)
x,y=E['v33']; wire((x,y),(95,y),(95,Y33b)); dot(95,Y33b)
x,y=E['gnd']; wire((x,y),(70,y)); gnd_down(70,y)
x,y=E['io35']; wire((x,y),(x,BB["BATT_SENSE"])); bd["BATT_SENSE"].append(x)
# power chain
J=ic(560,545,60,"J1","DC jack",right=[("DC+","p"),("DC−","m")])
U5=ic(740,545,100,"U5","HW-370 charger",left=[("IN+","ip"),("IN−","im")],right=[("OUT+","op"),("OUT−","om")])
U6=ic(930,545,100,"U6","2S BMS",left=[("P+","pp"),("P−","pm")],right=[("B+","bp"),("BM","bm"),("B−","bn")])
wire(J['p'],U5['ip']); wire(J['m'],U5['im']); wire(U5['op'],U6['pp']); wire(U5['om'],U6['pm'])
text(655,566,"DC_IN+",8,"start",False,"#3a8a63"); text(885,566,"PACK+",8,"middle",False,"#3a8a63")
# GND drop from − line
dot(690,605); wire((690,605),(690,BB["GND"])); bd["GND"].append(690)
# PACK+ to buck
U7=ic(1280,545,120,"U7","LM2596 buck module",left=[("IN+","ip"),("IN−","im")],right=[("OUT+","op"),("OUT−","om")])
dot(885,575); wire((885,575),(885,532),(1240,532),(1240,575),U7['ip'])
text(1060,527,"PACK+ (6–8.4 V)",8,"middle",False,"#3a8a63")
# cells
for yy in (575,605,635): wire((1060,yy),(1110,yy)) if False else None
wire(U6['bp'],(1110,575)); wire(U6['bm'],(1110,605)); wire(U6['bn'],(1110,635))
cell(1110,575); cell(1110,605); dot(1110,605); text(1125,595,"BT1  2 × 18650 (2S)",9); text(1125,607,"3.7 V 2200 mAh each",8)
wire((1110,635),(1110,BB["GND"])); bd["GND"].append(1110)
# buck outputs
x,y=U7['op']; wire((x,y),(x,Y5b)); dot(x,Y5b)
x,y=U7['om']; wire((x,y),(x,BB["GND"])); bd["GND"].append(x)
wire(U7['im'],(1250,605)) if False else None
wire(U7['im'],(1240,605)); wire((1240,605),(1240,BB["GND"])); bd["GND"].append(1240)
# divider
dot(670,575); wire((670,575),(670,690)); res(670,690,90,"R1","10k",side=-1)
res(670,750,90,"R2","10k",side=-1); wire((670,810),(690,810)); dot(690,810)
wire((670,750),(712,750),(712,BB["BATT_SENSE"])); dot(670,750); bd["BATT_SENSE"].append(712)
for n,y in BB.items(): bus(y,n,bd[n])
text(735,730,"R1 = R2 (ratio 2.0) → GPIO35, ADC1.",8,"start",False,"#888"); text(735,742,"Sensed rail must stay ≤ 6.6 V.",8,"start",False,"#888")
text(1455,660,"DC_IN+ = wall adapter output, PACK+ = 2S pack, +5V = buck output.",8,"start",False,"#888")
text(1455,676,"UART: ESP32 RX pin ← module TX; ESP32 TX pin → module RX.",8,"start",False,"#888")
text(1455,692,"Sensor/ADC pins on ADC1 only (ADC2 conflicts with Wi-Fi).",8,"start",False,"#888")

# ================= EMITTERS =================
def svg():
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Arial, Helvetica, sans-serif"><rect width="100%" height="100%" fill="#ffffff"/>']
    for it in items:
        k=it[0]
        if k=='line':
            _,p,c,w=it; o.append(f'<polyline points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in p)}" fill="none" stroke="{c}" stroke-width="{w}" stroke-linejoin="round"/>')
        elif k=='poly':
            _,p,c,f=it; o.append(f'<polygon points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in p)}" fill="{f}" stroke="{c}" stroke-width="1.1"/>')
        elif k=='rect':
            _,x,y,w,h,f,s_,sw=it; o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{f}" stroke="{s_}" stroke-width="{sw}"/>')
        elif k=='text':
            _,x,y,t,sz,an,b,c=it; o.append(f'<text x="{x}" y="{y}" font-size="{sz}" text-anchor="{an}" dominant-baseline="central" fill="{c}">{html.escape(t)}</text>')
        elif k=='circ':
            _,x,y,r,f,s_=it; o.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{f}" stroke="{s_}" stroke-width="1"/>')
    o.append('</svg>'); return "\n".join(o)
def drawio():
    cells=[]; n=[2]
    def nid(): n[0]+=1; return f"n{n[0]}"
    esc=lambda t: html.escape(t,quote=True)
    for it in items:
        k=it[0]; i=nid()
        if k=='line' or k=='poly':
            if k=='line': _,p,c,w=it; closed=False
            else: _,p,c,f=it; w=1.1; closed=True
            p=list(p)+([p[0]] if closed else [])
            if p[0]==p[-1] and len(p)==2: continue
            mid="".join(f'<mxPoint x="{x:.1f}" y="{y:.1f}"/>' for x,y in p[1:-1]); arr=f'<Array as="points">{mid}</Array>' if mid else ''
            cells.append(f'<mxCell id="{i}" value="" style="endArrow=none;html=1;rounded=0;strokeColor={c};strokeWidth={w};edgeStyle=none;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="{p[0][0]:.1f}" y="{p[0][1]:.1f}" as="sourcePoint"/><mxPoint x="{p[-1][0]:.1f}" y="{p[-1][1]:.1f}" as="targetPoint"/>{arr}</mxGeometry></mxCell>')
        elif k=='rect':
            _,x,y,w,h,f,s_,sw=it
            cells.append(f'<mxCell id="{i}" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor={f};strokeColor={s_};strokeWidth={sw};" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        elif k=='text':
            _,x,y,t,sz,an,b,c=it; wd=max(16,len(t)*sz*0.58+4); hh=sz+6
            al={"start":"left","middle":"center","end":"right"}[an]; px=x if an=="start" else (x-wd/2 if an=="middle" else x-wd)
            cells.append(f'<mxCell id="{i}" value="{esc(t)}" style="text;html=1;strokeColor=none;fillColor=none;align={al};verticalAlign=middle;whiteSpace=nowrap;spacing=0;fontSize={sz};fontFamily=Arial;fontColor={c};" vertex="1" parent="1"><mxGeometry x="{px:.1f}" y="{y-hh/2:.1f}" width="{wd:.1f}" height="{hh}" as="geometry"/></mxCell>')
        elif k=='circ':
            _,x,y,r,f,s_=it; cells.append(f'<mxCell id="{i}" value="" style="ellipse;whiteSpace=wrap;html=1;fillColor={f};strokeColor={s_};" vertex="1" parent="1"><mxGeometry x="{x-r}" y="{y-r}" width="{2*r}" height="{2*r}" as="geometry"/></mxCell>')
    return ('<mxfile host="app.diagrams.net"><diagram name="Schematic" id="s1"><mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" page="0" pageWidth="%d" pageHeight="%d"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'%(W,H)+"".join(cells)+'</root></mxGraphModel></diagram></mxfile>')
open("sch.svg","w",encoding="utf-8").write(svg()); open("sch.drawio","w",encoding="utf-8").write(drawio()); print(len(items))
