# تشغيل TeamTracker على شبكة داخلية (LAN)

دليل مبسّط لتشغيل السيرفر في البيت أو المكتب، ومراقبة أجهزة الموظفين على **نفس الواي فاي** بدون VPS وبدون إنترنت عام للبث.

---

## هل نسخة GitHub Desktop هي اللي أخوك يحمّلها؟

**نعم.** أخوك (أو أي موظف) يحمّل تطبيق الموظف الجاهز من:

**[GitHub Releases — TeamTracker](https://github.com/hamdymohamedak/TeamTracker/releases)**

هذا هو تطبيق الـ **desktop** المبني تلقائيًا (Mac / Windows / Linux).  
**مش** محتاج يحمّل الكود من GitHub ولا يشغّل `pnpm`.

### مهم جدًا

النسخ المبنية على GitHub مضبوطة افتراضيًا على السيرفر السحابي للإنتاج:

`https://tracker.hostly-eg.com`

عشان يشتغل عندك على الشبكة الداخلية، الموظف لازم يربط التطبيق بـ **عنوان سيرفرك المحلي** (IP جهاز الأدمن على الواي فاي)، مش يسيب الافتراضي السحابي.

يتم ذلك بـ:

1. إدخال **Setup Token** من الداشبورد، و  
2. إدخال **Server URL** = `http://IP-جهازك:3001`  
   أو وضع ملف تفعيل فيه نفس العنوان.

---

## الفكرة باختصار

```text
جهاز الأدمن (أنت)
  ├── يشغّل السيرفر على المنفذ 3001
  ├── يفتح الداشبورد
  └── IP مثلاً: 192.168.1.10

جهاز الموظف (أخوك) — نفس الواي فاي
  ├── يثبّت تطبيق TeamTracker من Releases
  ├── يدخل التوكن + http://192.168.1.10:3001
  └── يظهر أونلاين → تفتح Live Activity وتشوف الشاشة
```

جهازك لازم **يفضل شغال** ومتصل بالواي فاي طول ما المراقبة شغالة.

---

## المتطلبات

| عنصر | ملاحظة |
|------|--------|
| نفس الشبكة | نفس الراوتر / نفس الواي فاي |
| جهاز أدمن | عليه السيرفر + الداشبورد |
| جهاز موظف | تطبيق Desktop من Releases فقط |
| منفذ | `3001` مفتوح على جهاز الأدمن للشبكة المحلية |

---

## الجزء 1 — جهاز الأدمن (أنت)

### الخطوة 1: شغّل السيرفر

من مجلد المشروع:

```bash
cd admin
pnpm install
pnpm run dev
```

انتظر حتى يظهر أن السيرفر يستمع على المنفذ **3001**.

> للتطوير: Vite قد يكون على `5174` والـ API على `3001`.  
> للموظف على الـ LAN استخدم دائمًا: `http://IP:3001`

### الخطوة 2: اعرف IP جهازك على الشبكة

#### macOS

1. **System Settings → Network → Wi‑Fi → Details**  
   أو من التيرمينال:

```bash
ipconfig getifaddr en0
```

(جرّب `en1` لو `en0` فاضي.)

#### Windows

1. افتح **Command Prompt** أو PowerShell:

```bat
ipconfig
```

2. ابحث عن **IPv4 Address** تحت بطاقة الـ Wi‑Fi  
   مثال: `192.168.1.10`

#### Linux

```bash
ip -4 addr show
```

أو:

```bash
hostname -I
```

خذ عنوانًا يبدأ غالبًا بـ `192.168.` أو `10.`

### الخطوة 3: افتح الداشبورد

جرّب بالترتيب:

1. `http://IP-جهازك:3001`  
2. أو أثناء التطوير: `http://localhost:5174` (للأدمن فقط على نفس الجهاز)

سجّل دخول الأدمن كالمعتاد.

### الخطوة 4: اسمح للفايروول بالمنفذ 3001 (لو الاتصال فشل)

#### macOS

**System Settings → Network → Firewall**  
اسمح لـ Node / Terminal بقبول الاتصالات الواردة، أو عطّل الفايروول مؤقتًا للتجربة على الشبكة المنزلية فقط.

#### Windows

1. **Windows Defender Firewall → Advanced settings**  
2. **Inbound Rules → New Rule → Port → TCP 3001 → Allow**

أو مؤقتًا من PowerShell (كمسؤول):

```powershell
New-NetFirewallRule -DisplayName "TeamTracker LAN" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

#### Linux (ufw)

```bash
sudo ufw allow 3001/tcp
sudo ufw reload
```

### الخطوة 5: أضف الموظف واعمل Setup Token

1. من الداشبورد: **Employees → Add Employee**
2. افتح الموظف → **Setup Token**
3. انسخ التوكن وابعته لأخوك (واتساب / رسالة)

اختياري: **Install on this device** ينزّل ملف  
`teamtracker-activate-….json`  
لو هتستخدمه، تأكد أن `serverUrl` داخله = `http://IP-جهازك:3001`  
(لو الداشبورد مفتوح على `localhost`، عدّل الملف يدويًا أو خلّي أخوك يدخل الـ URL يدويًا في التطبيق.)

---

## الجزء 2 — جهاز الموظف (أخوك)

### الخطوة 1: حمّل التطبيق من GitHub Releases

افتح:

https://github.com/hamdymohamedak/TeamTracker/releases

حمّل الملف المناسب:

| النظام | ماذا يحمّل تقريبًا |
|--------|---------------------|
| **Windows** | ملف `.exe` أو Setup خاص بالـ employee tracker |
| **macOS Apple Silicon (M1/M2/M3…)** | نسخة **arm64** |
| **macOS Intel** | نسخة **x64** |
| **Linux** | **AppImage** أو **.deb** |

> لا تحمّل `desktop-admin` إلا لو محتاجه كصدفة أدمن. للموظف العادي: تطبيق **employee / desktop tracker**.

### الخطوة 2: ثبّت / شغّل حسب النظام

#### Windows

1. شغّل الـ installer / الـ exe  
2. لو ظهر **SmartScreen**: **More info → Run anyway**  
3. افتح TeamTracker  
4. اسمح بصلاحيات الشاشة إن طُلبت

#### macOS

1. افتح الملف (غالبًا `.dmg` أو `.zip` ثم التطبيق)  
2. لو Gatekeeper منع التشغيل: انقر يمين على التطبيق → **Open** → **Open**  
3. من **System Settings → Privacy & Security** اسمح بـ:
   - **Screen Recording**
   - **Accessibility** (إن طُلب)
4. أعد فتح التطبيق بعد إعطاء الصلاحيات

#### Linux

1. **AppImage:**  
   ```bash
   chmod +x TeamTracker*.AppImage
   ./TeamTracker*.AppImage
   ```  
2. **.deb:**  
   ```bash
   sudo dpkg -i teamtracker*.deb
   ```  
3. عند طلب مشاركة الشاشة / PipeWire وافق.

### الخطوة 3: الربط بسيرفر الشبكة الداخلية

عند أول تشغيل:

1. الصق **Setup Token** اللي وصلك من الأدمن  
2. في حقل السيرفر (Advanced / Server URL) اكتب:

```text
http://192.168.1.10:3001
```

(استبدل بالـ IP الحقيقي لجهاز الأدمن)

3. اضغط Connect / تفعيل

**بديل بدون كتابة يدوية:**  
ضع ملف `teamtracker-activate-….json` في مجلد **Downloads** قبل أول تشغيل، على أن يحتوي:

```json
{
  "setupToken": "الصق-التوكن-هنا",
  "serverUrl": "http://192.168.1.10:3001"
}
```

ثم افتح التطبيق — يحاول التفعيل تلقائيًا.

### الخطوة 4: تأكد أنه أونلاين

على داشبورد الأدمن المفروض يظهر الموظف **متصل / Online** خلال أقل من دقيقة.

---

## الجزء 3 — مشاهدة الشاشة (Live Activity)

1. من الأدمن: افتح **Live Activity / Dashboard**  
2. اختر الموظف  
3. اضغط **Start / تشغيل**

المتوقع على نفس الشبكة:

- نقل **WebRTC · LAN** (أسرع، FPS أعلى)  
- أو عند فشل WebRTC: **Binary WebSocket** عبر سيرفرك المحلي (أبطأ شوية، لكنه ما زال داخلي)

جهاز الأدمن والموظف لازم يفضلوا على نفس الواي فاي، والسيرفر شغال.

---

## ماذا لو حابب تبني نسخة Desktop مخصّصة للـ LAN؟

مش إجباري لو الموظف يكتب `Server URL` يدويًا.  
لو حابب الـ app يفتح مباشرة على سيرفر البيت:

```bash
cd desktop
TEAMTRACKER_SERVER_URL=http://192.168.1.10:3001 pnpm run build
```

ثم وزّع مخرجات البناء من مجلد `release/` بدل (أو مع) نسخة Releases العامة.

نسخة **Releases العامة من GitHub** تظل صالحة طالما التفعيل يحدد `serverUrl` للـ LAN.

---

## أعطال شائعة وحلول سريعة

| المشكلة | الحل |
|---------|------|
| الموظف مش بيظهر أونلاين | تأكد من IP، وأن السيرفر شغال، وأن الـ URL فيه المنفذ `3001` |
| التطبيق يتصل بالسحابة مش ببيتك | انسَ الافتراضي؛ اكتب `http://IP:3001` صراحة عند التفعيل |
| Live View أسود / Discovering | غالبًا WebRTC أو صلاحيات الشاشة؛ راجع Screen Recording على Mac |
| أخوك برّه البيت | السيرفر المحلي مش هيوصل — محتاج VPS أو VPN |
| IP تغيّر بعد إعادة الراوتر | حدّث الـ Server URL أو ابنِ/فعّل من جديد بالـ IP الجديد |
| فايروول يمنع | افتح TCP `3001` على جهاز الأدمن (القسم أعلاه) |

---

## ملخص سريع (نسخّة لصق)

**أنت**

1. `cd admin && pnpm run dev`  
2. اعرف IP الشبكة  
3. افتح الداشبورد  
4. أضف موظف → Setup Token  

**أخوك**

1. حمّل من [Releases](https://github.com/hamdymohamedak/TeamTracker/releases)  
2. ثبّت حسب ويندوز / ماك / لينكس  
3. توكن + `http://IP-جهازك:3001`  
4. صلاحيات الشاشة  

**أنت تاني**

5. Live Activity → Start  

---

## الفرق بين الأوضاع

| الوضع | السيرفر | تطبيق الموظف |
|-------|---------|----------------|
| **إنتاج سحابي** | `tracker.hostly-eg.com` | Releases كما هي + توكن فقط |
| **LAN / بيت** | جهازك على `IP:3001` | نفس Releases + توكن **و** Server URL للـ IP |
| **VPS خاص** | دومينك | Releases + Server URL لدومينك |

---

*هذا الدليل للتجربة المنزلية/المكتبية على شبكة واحدة. للمراقبة من خارج البيت استخدم [دليل النشر على VPS](./docs/DEPLOYMENT.md).*
