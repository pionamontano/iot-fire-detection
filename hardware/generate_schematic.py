import math, html
W,H=1900,940
SYM="#8b1a1a"; WIRE="#2e7d32"; TXT="#111111"; NET="#0b3d91"; FRAME="#777777"; GREY="#555555"
items=[]   # ('line',pts,color,w) ('rect',x,y,w,h,fill,stroke,sw) ('text',x,y,s,size,anchor,bold,color) ('circ',cx,cy,r,fill,stroke) ('tri',x,y,w,h,dir,fill,stroke)
def line(pts,c=SYM,w=1.6): items.append(('line',pts,c,w))
def wire(*pts): line(list(pts),WIRE,1.8)
def rect(x,y,w,h,fill="none",stroke=SYM,sw=1.6): items.append(('rect',x,y,w,h,fill,stroke,sw))
def text(x,y,s,size=10,anchor="start",bold=False,color=TXT): items.append(('text',x,y,s,size,anchor,bold,color))
def dot(x,y,r=3,c=WIRE): items.append(('circ',x,y,r,c,c))
def tri(x,y,w,h,d="east"): items.append(('tri',x,y,w,h,d,"#ffffff",SYM))
def T(pt,x,y,rot): # local->global; rot 0 or 90 (x->down)
    px,py=pt
    return (x+px,y+py) if rot==0 else (x-py,y+px)
def tx(x,y,rot,*pts): return [T(p,x,y,rot) for p in pts]

# ---- symbols ----
def section(x,y,w,h,title):
    rect(x,y,w,h,"none",FRAME,1.4); text(x+10,y+16,title,13,"start",True)
def label(x,y,name,side="r",dy=7):   # net label sitting above wire end
    if side=="r": text(x+3,y-dy,name,10,"start",True,NET)
    else: text(x-3,y-dy,name,10,"end",True,NET)
def gnd(x,y):
    line([(x,y),(x,y+8)]); line([(x-10,y+8),(x+10,y+8)]); line([(x-6,y+13),(x+6,y+13)]); line([(x-2.5,y+18),(x+2.5,y+18)])
def pwr(x,y,name):   # wire end at (x,y), symbol goes up
    line([(x,y),(x,y-10)],SYM); line([(x-9,y-10),(x+9,y-10)],SYM); text(x,y-20,name,10,"middle",True)
def res(x,y,rot,ref,val,L=60,side=1,below=False):
    a=(L-30)/2; pts=[(0,0),(a,0)]; z=[(a+i*5,(-6 if i%2==0 else 6)) for i in range(1,6)]
    pts+=[(a,0)]+z+[(a+30,0),(L,0)]; pts=[(0,0),(a,0)]+z+[(a+30,0),(L,0)]
    line(tx(x,y,rot,*pts))
    cx,cy=T((L/2,0),x,y,rot)
    if rot==0 and below: text(cx,cy+14,ref,10,"middle",True); text(cx,cy+27,val,10,"middle")
    elif rot==0: text(cx,cy-14,ref,10,"middle",True); text(cx,cy+16,val,10,"middle")
    else: text(cx+12*side,cy-6,ref,10,"start" if side>0 else "end",True); text(cx+12*side,cy+8,val,10,"start" if side>0 else "end")
    return T((0,0),x,y,rot),T((L,0),x,y,rot)
def cap(x,y,rot,ref,val,pol=False,L=60,side=1):
    m=L/2
    line(tx(x,y,rot,(0,0),(m-3,0))); line(tx(x,y,rot,(m+3,0),(L,0)))
    line(tx(x,y,rot,(m-3,-11),(m-3,11))); line(tx(x,y,rot,(m+3,-11),(m+3,11)))
    cx,cy=T((m,0),x,y,rot)
    if pol:
        px,py=T((m-12,-12),x,y,rot); text(px,py,"+",11,"middle",True)
    if rot==0: text(cx,cy-18,ref,10,"middle",True); text(cx,cy+22,val,10,"middle")
    else: text(cx+16*side,cy-6,ref,10,"start" if side>0 else "end",True); text(cx+16*side,cy+8,val,10,"start" if side>0 else "end")
    return T((0,0),x,y,rot),T((L,0),x,y,rot)
def led(x,y,ref,val,color="#c00000"):  # horizontal, anode left, 60 long
    line([(x,y),(x+20,y)]); tri(x+20,y-9,20,18,"east"); line([(x+40,y-9),(x+40,y+9)]); line([(x+40,y),(x+60,y)])
    line([(x+26,y-12),(x+34,y-20)]); line([(x+34,y-12),(x+42,y-20)])
    text(x+30,y+24,ref,10,"middle",True); 
    return (x,y),(x+60,y)
def ic(x,y,w,ref,title,left=[],right=[],pitch=30,top=30,stub=30,names=True):
    n=max(len(left),len(right)); h=top+pitch*(n-1)+30 if n else 60
    rect(x,y,w,h,"#fffbe8",SYM,1.8)
    text(x,y-8,ref,11,"start",True); text(x+w/2,y+h+13,title,10,"middle",False,GREY)
    out={}
    for i,p in enumerate(left):
        py=y+top+pitch*i; num,nm,key=p
        line([(x-stub,py),(x,py)]); text(x+5,py,nm,10,"start"); text(x-stub+2,py-7,num,8,"start",False,GREY)
        out[key]=(x-stub,py)
    for i,p in enumerate(right):
        py=y+top+pitch*i; num,nm,key=p
        line([(x+w,py),(x+w+stub,py)]); text(x+w-5,py,nm,10,"end"); text(x+w+stub-2,py-7,num,8,"end",False,GREY)
        out[key]=(x+w+stub,py)
    return out
def npn(x,y,ref,val):  # base (x,y); C (x+40,y-30); E (x+40,y+30)
    line([(x,y),(x+20,y)]); line([(x+20,y-14),(x+20,y+14)])
    line([(x+20,y-6),(x+40,y-18),(x+40,y-30)]); line([(x+20,y+6),(x+40,y+18),(x+40,y+30)])
    line([(x+34,y+22),(x+40,y+18),(x+33,y+15)])
    text(x+52,y-4,ref,10,"start",True); text(x+52,y+10,val,10,"start")
    return (x,y),(x+40,y-30),(x+40,y+30)
def pmos(x,y,ref,val): # gate (x,y); S (x+46,y-30) top; D (x+46,y+30)
    line([(x,y),(x+18,y)]); line([(x+18,y-14),(x+18,y+14)])
    for a,b in ((-14,-8),(-4,4),(8,14)): line([(x+25,y+a),(x+25,y+b)])
    line([(x+25,y-11),(x+46,y-11),(x+46,y-30)]); line([(x+25,y+11),(x+46,y+11),(x+46,y+30)]); line([(x+25,y),(x+46,y),(x+46,y+11)])
    line([(x+35,y-4),(x+25,y),(x+35,y+4)])
    text(x+58,y-4,ref,10,"start",True); text(x+58,y+10,val,10,"start")
    return (x,y),(x+46,y-30),(x+46,y+30)
def cell(x,y,ref=None): # vertical, 30 tall, + on top
    line([(x,y),(x,y+11)]); line([(x-11,y+11),(x+11,y+11)]); line([(x-6,y+17),(x+6,y+17)],SYM,3.2); line([(x,y+17),(x,y+30)])
    text(x-14,y+8,"+",10,"end",True)
def buzzer(x,y,ref,val): # + at (x,y) top, - bottom; 60 tall
    line([(x,y),(x,y+14)]); line([(x,y+46),(x,y+60)])
    items.append(('circ',x,y+30,16,"none",SYM)); text(x,y+28,"+",11,"middle",True)
    text(x+24,y+26,ref,10,"start",True); text(x+24,y+40,val,10,"start")

# ================= SECTIONS =================
# ---- Power ----
section(20,20,610,640,"Power: wall adapter → charger → 2S pack → 5 V")
J=ic(40,70,70,"J1","DC barrel jack",right=[("1","DC+","p"),("2","DC−","m")])
U5=ic(220,70,100,"U5","HW-370 charger",left=[("1","IN+","ip"),("2","IN−","im")],right=[("3","OUT+","op"),("4","OUT−","om")])
U6=ic(420,70,100,"U6","2S BMS",left=[("1","P+","pp"),("2","P−","pm")],right=[("3","B+","bp"),("4","BM","bm"),("5","B−","bn")])
wire(J['p'],U5['ip']); wire(J['m'],U5['im'])
label(142,100,"DC_IN+","r"); dot(165,130); gnd(165,130)
wire(U5['op'],U6['pp']); wire(U5['om'],U6['pm']); label(352,100,"PACK+","r"); dot(370,130); gnd(370,130)
# fix: gnd symbols drawn at wire end
wire(U6['bp'],(575,100)); wire(U6['bm'],(575,130)); wire(U6['bn'],(575,160))
cell(575,100); cell(575,130); dot(575,130)
gnd(575,160)
text(575,196,"BT1: 2 × 18650 (2S)",10,"middle",True); text(575,210,"3.7 V 2200 mAh each",9,"middle",False,GREY)
text(40,190,"5 V wall adapter",9,"start",False,GREY)
U7=ic(180,250,130,"U7","LM2596 buck module",left=[("1","IN+","ip"),("2","IN−","im")],right=[("3","OUT+","op"),("4","OUT−","om")])
label(150,280,"PACK+","l"); gnd(*U7['im'])
pwr(*U7['op'],"+5V"); gnd(*U7['om'])
text(340,330,"adjust output to 5.0 V before connecting loads",9,"start",False,GREY)
# DC-in sense
text(40,392,"DC-in / battery sense  (GPIO35, ADC1)",11,"start",True)
label(100,430,"DC_IN+","r")
a,b=res(100,430,90,"R1","10 kΩ",side=1)
dot(100,490); wire((100,490),(200,490)); label(200,490,"BATT_SENSE","r")
c,d=res(100,490,90,"R2","10 kΩ",side=1); gnd(*d)
text(40,590,"BATTERY_DIVIDER_RATIO = 2.0 (R1 = R2)",9,"start",False,GREY)
text(40,604,"GPIO35 is ADC1 / input-only; keep DC_IN+ ≤ 6.6 V",9,"start",False,GREY)
text(340,350,"U7 OUT+ is the +5V rail",9,"start",False,GREY)
text(340,364,"(ESP32 VIN, SIM800L, MQ-7 heater)",9,"start",False,GREY)

# ---- ESP32 ----
section(640,20,460,640,"Microcontroller")
L=[("","VIN","vin"),("","3V3","v33"),("","GND","gnd"),("","IO35  (ADC1_CH7)","io35")]
R=[("","IO16  (RX2)","io16"),("","IO17  (TX2)","io17"),("","IO26  (RX1)","io26"),("","IO27  (TX1)","io27"),
   ("","IO4","io4"),("","IO34  (ADC1_CH6)","io34"),("","IO25  (PWM)","io25"),("","IO14","io14"),("","IO12","io12"),("","IO13","io13"),("","IO32","io32")]
E=ic(790,70,200,"U1","ESP32 DevKit V1",left=L,right=R,stub=30)
pwr(*E['vin'],"+5V"); pwr(*E['v33'],"+3V3"); gnd(*E['gnd']); label(*E['io35'],"BATT_SENSE","l")
nets={'io16':"GPS_TX",'io17':"GPS_RX",'io26':"SIM_TXD",'io27':"SIM_RXD",'io4':"ONEWIRE",'io34':"MQ7_AO",'io25':"MQ7_PWM",'io14':"LED_Y",'io12':"LED_R",'io13':"LED_B",'io32':"BUZZER"}
for k,v in nets.items(): label(*E[k],v,"r")
text(660,470,"Net labels with the same name are connected.",9,"start",False,GREY)
text(660,484,"GPS_TX / SIM_TXD are module outputs into the ESP32 RX pins.",9,"start",False,GREY)
text(660,498,"Sensor/ADC pins are all ADC1 (ADC2 conflicts with Wi-Fi).",9,"start",False,GREY)

# ---- GPS ----
section(1110,20,360,210,"GPS")
G=ic(1290,50,100,"U2","GY-GPS6MV2 (NEO-6M)",left=[("1","VCC","vcc"),("2","RX","rx"),("3","TX","tx"),("4","GND","gnd")])
pwr(*G['vcc'],"+3V3"); label(*G['rx'],"GPS_RX","l"); label(*G['tx'],"GPS_TX","l"); gnd(*G['gnd'])
text(1130,224,"9600 baud, Serial2 (ESP32 RX2 = IO16, TX2 = IO17)",9,"start",False,GREY)
# ---- SIM800L ----
section(1110,240,360,240,"GSM / SMS fallback")
S=ic(1290,290,100,"U3","SIM800L EVB",left=[("1","VCC","vcc"),("2","GND","gnd"),("3","TXD","txd"),("4","RXD","rxd")])
pwr(*S['vcc'],"+5V"); gnd(*S['gnd']); label(*S['txd'],"SIM_TXD","l"); label(*S['rxd'],"SIM_RXD","l")
cap(1415,360,90,"C1","1000µF",pol=True,side=1)
pwr(1415,360,"+5V"); gnd(1415,420)
text(1130,466,"9600 baud, Serial1. Needs ~2 A bursts: keep C1 close.",9,"start",False,GREY)
# ---- DS18B20 ----
section(1110,490,360,170,"Temperature")
D=ic(1290,520,100,"U4","DS18B20 terminal module",left=[("1","VDD","vdd"),("2","DQ","dq"),("3","GND","gnd")])
pwr(*D['vdd'],"+3V3"); gnd(*D['gnd'])
x0,y0=D['dq']; wire((x0,y0),(x0-70,y0)); dot(x0-40,y0); label(x0-70,y0,"ONEWIRE","l")
# vertical pull-up going UP from junction: draw by hand
jx=x0-40; line([(jx,y0),(jx,y0-12)]); 
zz=[(jx,y0-12)]+[(jx+(6 if i%2==0 else -6),y0-12-(i*5)) for i in range(1,6)]+[(jx,y0-42),(jx,y0-54)]
line(zz); pwr(jx,y0-54,"+3V3"); text(jx+12,y0-26,"R3",10,"start",True); text(jx+12,y0-13,"4.7 kΩ",10)

# ---- MQ-7 ----
section(1480,20,400,320,"CO sensor + heater driver")
M=ic(1780,150,80,"U5","MQ-7 module",left=[("1","VCC","vcc"),("2","AO","ao"),("3","GND","gnd")],stub=30,top=30)
# Q1 p-mos high-side switch for MQ-7 supply
g,s,d=pmos(1640,140,"Q1","P-MOSFET")
pwr(s[0],s[1],"+5V"); wire(d,(d[0],M['vcc'][1])); wire((d[0],M['vcc'][1]),M['vcc']); 
b,c,e=npn(1580,200,"Q2","NPN")
dot(1620,140); wire((1620,140),g); wire(c,(1620,140))
# gate pull-up R4 to +5V
x=1620; line([(x,140),(x,128)]); zz=[(x,128)]+[(x+(6 if i%2==0 else -6),128-i*5) for i in range(1,6)]+[(x,98),(x,86)]; line(zz); pwr(x,86,"+5V")
text(x+12,102,"R4",10,"start",True); text(x+12,115,"10 kΩ",10)
gnd(*e)
wire(b,(1560,200)); a1,a2=res(1500,200,0,"R5","1 kΩ",below=True); wire(a1,(1490,200)); label(1488,200,"MQ7_PWM","r",dy=16)
label(*M['ao'],"MQ7_AO","l"); gnd(*M['gnd'])
text(1500,300,"PWM on IO25: 100 % = 5 V heat, 28 % ≈ 1.4 V measure.",9,"start",False,GREY)
text(1500,314,"AO swings ≤ 1.4 V → safe for ADC1 (IO34). DO not used.",9,"start",False,GREY)
# ---- Indicators ----
section(1480,350,400,310,"Indicators")
def ledrow(y,net,ref,color,name):
    wire((1500,y),(1530,y)); label(1500,y,net,"r")
    p,q=res(1530,y,0,"R"+ref,"220 Ω")
    wire(q,(1620,y)); a,k=led(1620,y,"D"+ref+"  "+name,"",color); wire(k,(1700,y)); gnd(1700,y)
ledrow(410,"LED_Y","6","#e6c300","Tier 1 (yellow)")
ledrow(465,"LED_R","7","#c00000","Tier 2 (red)")
ledrow(525,"LED_B","8","#0066cc","Wi-Fi (blue)")
label(1500,572,"BUZZER","r"); wire((1500,572),(1640,572))
buzzer(1640,572,"BZ1","Active buzzer"); gnd(1640,632)
text(1672,626,"HIGH = on (Tier 2)",9,"start",False,GREY)

# ---- notes + title block ----
rect(20,680,1080,240,"none",FRAME,1.4); text(30,696,"Notes",13,"start",True)
notes=["1. Pin map follows firmware config.example.h: MQ7 AO=34, MQ7 heater PWM=25, DS18B20=4, GPS RX/TX=16/17, SIM800L RX/TX=26/27,",
"    battery sense=35, LEDs Y/R/B=14/12/13, buzzer=32.",
"2. UART crossover: ESP32 RX pin (IO16 / IO26) connects to the module TX; ESP32 TX pin (IO17 / IO27) connects to the module RX.",
"3. GPS VCC on 3V3 (GY-GPS6MV2 accepts 3.3-5 V). DS18B20 needs the 4.7 kΩ pull-up to 3V3 on DQ.",
"4. MQ-7 high-side driver (Q1/Q2/R4/R5) is a reference design: the firmware only says BJT/MOSFET. Heater Vc is the PWM output, not the 5 V rail.",
"5. SIM800L chip wants 3.4-4.4 V and ~2 A bursts (firmware guide: dedicated 4.0 V rail). The EVB board is drawn on +5V; confirm its input range.",
"6. DC-in sense is drawn on the adapter output; the firmware does not say which rail the divider reads. Confirm.",
"7. Mains path: J1 → HW-370 charger → 2S BMS → 2×18650. PACK+ (6–8.4 V) feeds only the LM2596 buck; never the 5 V pins."]
for i,n in enumerate(notes): text(30,718+i*20,n,10)
rect(1110,680,770,240,"none",SYM,2); 
line([(1110,740),(1880,740)]); line([(1110,800),(1880,800)]); line([(1500,800),(1500,920)]); line([(1700,800),(1700,920)]); line([(1500,860),(1880,860)])
text(1125,720,"TITLE:  IoT Fire Detection Node (AgapSense)  ESP32",15,"start",True)
text(1125,766,"Design after the SparkFun RedBoard-style sheet layout",10,"start",False,GREY)
text(1125,784,"Pin assignments from firmware/agapsense-firmware/src/config.example.h",10,"start",False,GREY)
text(1125,824,"Document Number:",10,"start",False,GREY); text(1125,845,"FD-NODE-01",12,"start",True)
text(1510,824,"Rev:",10,"start",False,GREY); text(1510,845,"1.0",12,"start",True)
text(1710,824,"Sheet:",10,"start",False,GREY); text(1710,845,"1/1",12,"start",True)
text(1510,880,"Date: 2026-10-02",10); text(1710,880,"Net labels = same net",10)

# ================= EMITTERS =================
def svg():
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Arial, Helvetica, sans-serif"><rect width="100%" height="100%" fill="#ffffff"/>']
    for it in items:
        k=it[0]
        if k=='line':
            _,p,c,w=it; o.append(f'<polyline points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in p)}" fill="none" stroke="{c}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>')
        elif k=='rect':
            _,x,y,w,h,f,s_,sw=it; o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{f}" stroke="{s_}" stroke-width="{sw}"/>')
        elif k=='text':
            _,x,y,t,sz,an,b,c=it; o.append(f'<text x="{x}" y="{y}" font-size="{sz}" text-anchor="{an}" dominant-baseline="central" font-weight="{"bold" if b else "normal"}" fill="{c}">{html.escape(t)}</text>')
        elif k=='circ':
            _,x,y,r,f,s_=it; o.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{f}" stroke="{s_}" stroke-width="1.6"/>')
        elif k=='tri':
            _,x,y,w,h,d,f,s_=it; o.append(f'<polygon points="{x},{y} {x},{y+h} {x+w},{y+h/2}" fill="{f}" stroke="{s_}" stroke-width="1.6"/>')
    o.append('</svg>'); return "\n".join(o)
def drawio():
    cells=[]; n=[2]
    def nid(): n[0]+=1; return f"n{n[0]}"
    def esc(t): return html.escape(t,quote=True)
    for it in items:
        k=it[0]; i=nid()
        if k=='line':
            _,p,c,w=it; a,b=p[0],p[-1]; mid="".join(f'<mxPoint x="{x:.1f}" y="{y:.1f}"/>' for x,y in p[1:-1])
            arr=f'<Array as="points">{mid}</Array>' if mid else ''
            cells.append(f'<mxCell id="{i}" value="" style="endArrow=none;html=1;rounded=0;strokeColor={c};strokeWidth={w};edgeStyle=none;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="{a[0]:.1f}" y="{a[1]:.1f}" as="sourcePoint"/><mxPoint x="{b[0]:.1f}" y="{b[1]:.1f}" as="targetPoint"/>{arr}</mxGeometry></mxCell>')
        elif k=='rect':
            _,x,y,w,h,f,s_,sw=it; fill=f if f!="none" else "none"
            cells.append(f'<mxCell id="{i}" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={s_};strokeWidth={sw};" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        elif k=='text':
            _,x,y,t,sz,an,b,c=it; wd=max(20,len(t)*sz*0.62+6); hh=sz+8
            al={"start":"left","middle":"center","end":"right"}[an]; px=x if an=="start" else (x-wd/2 if an=="middle" else x-wd)
            cells.append(f'<mxCell id="{i}" value="{esc(t)}" style="text;html=1;strokeColor=none;fillColor=none;align={al};verticalAlign=middle;whiteSpace=nowrap;spacing=0;spacingLeft=0;spacingRight=0;fontSize={sz};fontFamily=Arial;fontStyle={1 if b else 0};fontColor={c};" vertex="1" parent="1"><mxGeometry x="{px:.1f}" y="{y-hh/2:.1f}" width="{wd:.1f}" height="{hh}" as="geometry"/></mxCell>')
        elif k=='circ':
            _,x,y,r,f,s_=it; cells.append(f'<mxCell id="{i}" value="" style="ellipse;whiteSpace=wrap;html=1;fillColor={f};strokeColor={s_};strokeWidth=1.6;" vertex="1" parent="1"><mxGeometry x="{x-r}" y="{y-r}" width="{2*r}" height="{2*r}" as="geometry"/></mxCell>')
        elif k=='tri':
            _,x,y,w,h,d,f,s_=it; cells.append(f'<mxCell id="{i}" value="" style="triangle;whiteSpace=wrap;html=1;direction={d};fillColor={f};strokeColor={s_};strokeWidth=1.6;" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
    return ('<mxfile host="app.diagrams.net"><diagram name="Schematic" id="s1"><mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" page="0" pageWidth="%d" pageHeight="%d"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'%(W,H)+"".join(cells)+'</root></mxGraphModel></diagram></mxfile>')
import sys
open("sch.svg","w",encoding="utf-8").write(svg()); open("sch.drawio","w",encoding="utf-8").write(drawio())
print(len(items))
