"use strict";
const $ = (id) => document.getElementById(id),
  base = "/app/modules/api";
let me = null,
  currentItems = [],
  offset = 0,
  search = "",
  board = false;
const stages = {
  NEW: "חדש",
  CONTACTED: "לא עונה",
  IN_PROGRESS: "ליד איכותי",
  MEETING: "נקבעה פגישה",
  WON: "נסגרה עסקה",
  LOST: "לא נסגר",
  IRRELEVANT: "לא רלוונטי",
};
const stateLabels = {
  DRAFT: "טיוטה",
  REVIEW_REQUESTED: "ממתין לבדיקה",
  SCHEDULED: "מתוכנן",
  OPEN: "פתוח",
  CLOSED: "סגור",
  NEW: "חדש",
  READ: "נקרא",
  DONE: "הושלם",
  CANCELLED: "בוטל",
  PENDING: "ממתין",
  ACTIVE: "פעיל",
  CANCEL_PENDING: "ממתין לביטול",
  CHECKOUT_UNCERTAIN: "נדרש בירור תשלום",
  PROCESSING: "בתהליך",
  COMPLETE: "הושלם",
  FAILED: "לא הושלם",
};
function money(amount, currency) {
  try {
    const formatter = new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: currency.toUpperCase(),
    });
    return formatter.format(
      amount / 10 ** formatter.resolvedOptions().maximumFractionDigits,
    );
  } catch {
    return amount + " " + currency;
  }
}
const pages = {
  connections: "החיבורים שלי",
  crm: "לקוחות ולידים",
  campaigns: "קמפיינים",
  media: "ספריית מדיה",
  posts: "פוסטים ולוח תוכן",
  billing: "מנויים וקרדיטים",
  business: "פרטי העסק ומיתוג",
  tasks: "משימות ופגישות",
  support: "מרכז תמיכה",
  knowledge: "מרכז ידע",
  activity: "היסטוריית פעילות",
  settings: "הגדרות משתמש",
};
const messages = {
  LOGIN_REQUIRED: "יש להתחבר כדי לצפות בנתונים.",
  INVALID_LOGIN: "מפתח הגישה לא זוהה.",
  PERMISSION_DENIED: "אין לך הרשאה לפעולה הזו.",
  REVISION_CONFLICT: "הנתונים עודכנו במקביל. רענן ונסה שוב.",
  PROVIDER_NOT_CONFIGURED: "נדרשת הגדרת אפליקציה והרשאות אצל ספק השירות.",
  SITE_NOT_ALLOWLISTED: "מנהל הסביבה צריך לאשר את כתובת האתר לפני חיבורו.",
  ADS_DEVELOPER_TOKEN_REQUIRED: "נדרש Developer Token מאושר של Google Ads.",
  ADS_API_VERSION_REQUIRED: "נדרשת הגדרת גרסת Google Ads API נתמכת.",
  SHOPIFY_API_VERSION_REQUIRED: "נדרשת הגדרת גרסת Shopify API נתמכת.",
  RECONNECT_REQUIRED: "יש לחדש את החיבור.",
  CONNECTION_EXPIRED: "תוקף החיבור פג. התחבר מחדש.",
  ACCOUNT_SELECTION_REQUIRED: "יש לבחור חשבון מחובר.",
  BILLING_SANDBOX_NOT_CONFIGURED: "ספק התשלום בסביבת הבדיקה טרם הוגדר.",
  BILLING_ADMIN_REQUIRED: "רק מנהל החיובים המוגדר יכול ליצור חבילות.",
  INSUFFICIENT_CREDITS: "אין מספיק קרדיטים לביצוע הפעולה.",
  EXPLICIT_CONFIRMATION_REQUIRED: "יש לאשר במפורש את העלות לפני ביצוע.",
  AI_RESULT_UNCERTAIN:
    "לא התקבלה תוצאה מלאה. הקרדיט נשמר לבירור ואין לנסות שוב אוטומטית.",
  AI_DISABLED: "יצירה באמצעות AI אינה מופעלת בסביבה הזו.",
  AI_PROVIDER_NOT_CONFIGURED: "ספק היצירה המבוקש טרם הוגדר.",
  ASSET_IN_USE: "המדיה משויכת לטיוטה. הסר את השיוך לפני מחיקה.",
  RATE_LIMITED: "בוצעו יותר מדי בקשות. המתן דקה ונסה שוב.",
  CAMPAIGN_INCOMPLETE:
    "יש להשלים מטרה, מוצר, קהל, תקציב, מטבע, כותרת, טקסט ומדיה לפני בקשת אישור.",
  LIFECYCLE_PLATFORM_UNSUPPORTED: "מסלול האישורים הקיים תומך כרגע ב־Meta בלבד.",
  PROVIDER_SYNC_FAILED: "הסנכרון נכשל. בדוק את החיבור וההרשאות.",
  INVALID_INPUT: "יש לבדוק את פרטי הטופס.",
  INVALID_PHONE: "יש להזין טלפון בינלאומי עם + וקידומת מדינה.",
  INVALID_EMAIL: "כתובת האימייל אינה תקינה.",
  SUBSCRIPTION_EXISTS: "כבר קיים מנוי פעיל או תהליך הרשמה פתוח.",
  CSV_LIMIT: "ניתן לייבא עד 500 שורות בכל פעם.",
  INVALID_CSV_HEADERS: "כותרות הייבוא הנתמכות: name,phone,email,notes,source.",
  MODULE_UNAVAILABLE: "השירות אינו זמין כרגע. נסה שוב מאוחר יותר.",
};
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (v !== false && v !== null && v !== undefined)
      n.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined)
      n.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return n;
}
let statusTimer;
function say(message) {
  clearTimeout(statusTimer);
  $("status").textContent = message;
  statusTimer = setTimeout(() => {
    $("status").textContent = "";
  }, 6000);
}
function error(e) {
  say(messages[e.code] || "לא ניתן להשלים את הפעולה. בדוק את הפרטים והחיבור.");
}
async function api(path, method = "GET", body, raw = false) {
  const r = await fetch(base + path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Dashboard-Request": "1",
      ...(raw
        ? { "Content-Type": body.type }
        : { "Content-Type": "application/json" }),
    },
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  if (!r.ok) {
    if (r.status === 401) loginUI();
    throw Object.assign(Error(data.code), {
      code: data.code || "MODULE_UNAVAILABLE",
    });
  }
  return data;
}
async function legacy(path, method = "GET", body) {
  const r = await fetch("/app/api" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Dashboard-Request": "1" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  if (!r.ok) {
    if (r.status === 401) loginUI();
    throw Object.assign(Error(data.code || "MODULE_UNAVAILABLE"), {
      code: data.code || "MODULE_UNAVAILABLE",
    });
  }
  return data;
}
function button(label, action, write = false) {
  const b = el(
    "button",
    {
      type: "button",
      disabled: write && me?.role !== "owner",
      onclick: async () => {
        b.disabled = true;
        try {
          await action();
        } catch (e) {
          error(e);
        } finally {
          if (b.isConnected) b.disabled = write && me?.role !== "owner";
        }
      },
    },
    label,
  );
  return b;
}
function actions(...nodes) {
  return el("div", { class: "module-actions" }, nodes);
}
function note(value) {
  return el("p", { class: "module-note" }, value);
}
function card(title, ...nodes) {
  return el("section", { class: "module-card" }, el("h2", {}, title), nodes);
}
function empty(label = "עדיין אין נתונים להצגה.") {
  return el("p", { class: "module-muted" }, label);
}
function table(headers, rows) {
  return el(
    "div",
    { class: "module-table" },
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          headers.map((h) => el("th", { scope: "col" }, h)),
        ),
      ),
      el(
        "tbody",
        {},
        rows.map((row) =>
          el(
            "tr",
            {},
            row.map((c) => el("td", {}, c)),
          ),
        ),
      ),
    ),
  );
}
function close() {
  if ($("editor").open) $("editor").close();
}
function show(title, content) {
  close();
  $("editor").replaceChildren(
    el("h2", { id: "editor-title" }, title),
    content,
    button("סגירה", close),
  );
  $("editor").showModal();
}
function confirmDialog(title, description, action) {
  show(
    title,
    el(
      "div",
      {},
      el("p", {}, description),
      button(
        "אישור",
        async () => {
          await action();
          close();
          await render();
        },
        true,
      ),
    ),
  );
}
function form(title, fields, initial, onSave, wizard = false) {
  const f = el("form", {}),
    inputs = {},
    groups = new Map();
  let step = 0;
  for (const field of fields) {
    const group = field.step || 0;
    if (!groups.has(group))
      groups.set(group, el("div", { class: "module-form-grid" }));
    const value = initial[field.key] ?? field.default ?? "";
    let input;
    if (field.options) {
      input = el(
        "select",
        { name: field.key, required: !!field.required },
        field.options.map((o) =>
          el(
            "option",
            { value: typeof o === "string" ? o : o[0] },
            typeof o === "string" ? o : o[1],
          ),
        ),
      );
      input.value = value;
    } else if (field.type === "textarea")
      input = el(
        "textarea",
        { name: field.key, maxlength: field.max || 4000 },
        value,
      );
    else {
      input = el("input", {
        name: field.key,
        type: field.type || "text",
        required: !!field.required,
        maxlength: field.max || 200,
        ...(field.type === "number" ? { min: 0, step: "any" } : {}),
      });
      input.value = value;
    }
    inputs[field.key] = { input, field };
    groups
      .get(group)
      .append(
        el("label", { class: field.wide ? "wide" : "" }, field.label, input),
      );
  }
  const groupNodes = [...groups.values()],
    progress = el("p", { class: "module-wizard-step" }),
    previous = button("הקודם", () => {
      step--;
      update();
    }),
    next = button("הבא", () => {
      if (
        [...groupNodes[step].querySelectorAll("input, select, textarea")].every(
          (control) => control.reportValidity(),
        )
      ) {
        step++;
        update();
      }
    }),
    save = el("button", { type: "submit", class: "primary" }, "שמירה");
  function update() {
    groupNodes.forEach((g, i) => (g.hidden = wizard && i !== step));
    progress.textContent = wizard
      ? `שלב ${step + 1} מתוך ${groupNodes.length}`
      : "";
    previous.hidden = !wizard || step === 0;
    next.hidden = !wizard || step === groupNodes.length - 1;
    save.hidden = wizard && step !== groupNodes.length - 1;
  }
  f.append(progress, ...groupNodes, actions(previous, next, save));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      const data = {};
      for (const [key, { input, field }] of Object.entries(inputs)) {
        if (field.type === "number")
          data[key] = input.value === "" ? 0 : Number(input.value);
        else if (field.type === "ids")
          data[key] = input.value.trim()
            ? input.value.split(",").map((v) => v.trim())
            : [];
        else data[key] = input.value;
      }
      await onSave(data);
      close();
      say("נשמר בהצלחה");
      await render();
    } catch (err) {
      error(err);
    } finally {
      save.disabled = false;
    }
  });
  update();
  show(title, f);
}
function pager(data) {
  const previous = button("הקודם", async () => {
    offset = Math.max(0, offset - 50);
    await render();
  });
  const next = button("הבא", async () => {
    offset += 50;
    await render();
  });
  previous.disabled = offset === 0;
  next.disabled = !data.hasMore;
  $("toolbar").append(
    previous,
    el("span", {}, `עמוד ${offset / 50 + 1}`),
    next,
  );
}
const leadFields = [
  { key: "name", label: "שם", required: true },
  { key: "phone", label: "טלפון בינלאומי", type: "tel" },
  { key: "email", label: "אימייל", type: "email" },
  {
    key: "status",
    label: "סטטוס",
    options: Object.entries(stages),
    default: "NEW",
  },
  { key: "source", label: "מקור", default: "manual" },
  { key: "assignee", label: "אחראי" },
  { key: "estimatedValue", label: "שווי עסקה משוער", type: "number" },
  { key: "actualValue", label: "שווי עסקה בפועל", type: "number" },
  { key: "currency", label: "מטבע (למשל ILS)", default: "ILS" },
  { key: "platform", label: "פלטפורמת מקור" },
  { key: "campaignId", label: "מזהה קמפיין" },
  { key: "adId", label: "מזהה מודעה" },
  { key: "notes", label: "הערות", type: "textarea", wide: true },
];
function editLead(row) {
  form(
    row ? "עריכת ליד" : "ליד חדש",
    leadFields,
    { ...row, ...row?.details },
    async (data) => {
      const details = {};
      for (const k of [
        "assignee",
        "estimatedValue",
        "actualValue",
        "currency",
        "platform",
        "campaignId",
        "adId",
      ]) {
        details[k] = data[k];
        delete data[k];
      }
      data.details = details;
      if (row) {
        data.revision = row.revision;
        await api("/leads/" + row.id, "PATCH", data);
      } else await api("/leads", "POST", data);
    },
  );
}
async function leadDetail(row) {
  const notes = await api("/leads/" + row.id + "/notes");
  show(
    row.name,
    el(
      "div",
      {},
      el("p", {}, row.phone || row.email || "ללא פרטי קשר"),
      el("p", {}, row.notes),
      el(
        "ul",
        {},
        notes.items.map((n) => el("li", {}, n.body)),
      ),
      actions(
        button("עריכה", () => editLead(row), true),
        button(
          "הוספת הערה",
          () =>
            form(
              "הערה חדשה",
              [
                {
                  key: "body",
                  label: "הערה",
                  type: "textarea",
                  required: true,
                },
              ],
              {},
              (d) => api("/leads/" + row.id + "/notes", "POST", d),
            ),
          true,
        ),
        button(
          "פגישה",
          () => editRecord("appointment", null, { leadId: row.id }),
          true,
        ),
        button(
          "מחיקת ליד",
          () =>
            confirmDialog(
              "מחיקת ליד",
              "הליד והערותיו יימחקו. פעולה זו אינה מוחקת נתוני ספק חיצוני.",
              () =>
                api("/leads/" + row.id, "DELETE", { revision: row.revision }),
            ),
          true,
        ),
      ),
    ),
  );
}
async function crm() {
  const [data, summary] = await Promise.all([
    api("/leads?offset=" + offset + "&q=" + encodeURIComponent(search)),
    api("/crm/summary"),
  ]);
  currentItems = data.items;
  $("toolbar").append(
    button("ליד חדש", () => editLead(), true),
    button(board ? "תצוגת טבלה" : "תצוגת Kanban", async () => {
      board = !board;
      await render();
    }),
    button(
      "ייצוא CSV",
      () => {
        location.href = base + "/crm/export";
      },
      true,
    ),
    button("ייבוא CSV", importLeads, true),
    button("כפילויות", duplicateLeads, true),
  );
  const filter = el("input", {
    class: "module-search",
    type: "search",
    placeholder: "חיפוש שם, טלפון או אימייל",
    "aria-label": "חיפוש לידים",
  });
  filter.value = search;
  const searchForm = el(
    "form",
    {},
    actions(filter, el("button", { type: "submit" }, "חיפוש")),
  );
  searchForm.onsubmit = (e) => {
    e.preventDefault();
    search = filter.value;
    offset = 0;
    render();
  };
  $("toolbar").append(searchForm);
  $("body").append(
    el(
      "div",
      { class: "module-grid" },
      summary.byStatus.map((s) =>
        card(
          stages[s.status],
          el("p", { class: "module-count" }, s.count),
          s.status === "WON"
            ? el(
                "p",
                {},
                "סכומי עסקאות נשמרים במטבע הרשומה; אין לחבר מטבעות שונים.",
              )
            : null,
        ),
      ),
    ),
  );
  if (!data.items.length) $("body").append(empty());
  else if (board)
    $("body").append(
      el(
        "div",
        { class: "module-board" },
        Object.entries(stages).map(([id, label]) =>
          el(
            "section",
            { class: "module-lane" },
            el("h2", {}, label),
            data.items
              .filter((r) => r.status === id)
              .map((r) =>
                card(
                  r.name,
                  el("p", { dir: "ltr" }, r.phone || r.email),
                  button("פרטים", () => leadDetail(r)),
                ),
              ),
          ),
        ),
      ),
    );
  else
    $("body").append(
      table(
        ["שם", "פרטי קשר", "סטטוס", "מקור", "אחראי", "פעולות"],
        data.items.map((r) => [
          r.name,
          el("span", { dir: "ltr" }, r.phone || r.email),
          stages[r.status],
          { manual: "ידני", dashboard: "דשבורד" }[r.source] || r.source,
          r.details.assignee || "—",
          button("פרטים", () => leadDetail(r)),
        ]),
      ),
    );
  pager(data);
}
function importLeads() {
  const file = el("input", { type: "file", accept: ".csv,text/csv" });
  show(
    "ייבוא לידים",
    el(
      "div",
      {},
      el(
        "p",
        {},
        "כותרות: name,phone,email,notes,source. עד 500 שורות. פרטי קשר שכבר קיימים באותו עסק ידולגו.",
      ),
      file,
      button(
        "ייבוא",
        async () => {
          if (!file.files[0]) return;
          const r = await api("/crm/import", "POST", {
            csv: await file.files[0].text(),
          });
          close();
          await render();
          say(`יובאו ${r.imported} לידים, דולגו ${r.skipped}.`);
        },
        true,
      ),
    ),
  );
}
async function duplicateLeads() {
  const data = await api("/crm/duplicates");
  show(
    "כפילויות לפי טלפון או אימייל",
    el(
      "div",
      {},
      data.items.length
        ? data.items.map((g) =>
            card(
              g.contact,
              el("p", {}, g.ids.join(", ")),
              button(
                "מיזוג שני הראשונים",
                async () => {
                  const all = await api(
                    "/leads?q=" + encodeURIComponent(g.contact),
                  );
                  const target = all.items.find((r) => r.id === g.ids[0]),
                    source = all.items.find((r) => r.id === g.ids[1]);
                  if (!target || !source) throw { code: "MODULE_UNAVAILABLE" };
                  confirmDialog(
                    "מיזוג לידים",
                    `למזג את ${source.name} לתוך ${target.name}? רשומת המקור תימחק.`,
                    () =>
                      api("/crm/merge", "POST", {
                        target: target.id,
                        source: source.id,
                        revisions: {
                          target: target.revision,
                          source: source.revision,
                        },
                      }),
                  );
                },
                true,
              ),
            ),
          )
        : empty("לא נמצאו כפילויות."),
    ),
  );
}
const platforms = [
  ["meta", "Facebook / Instagram"],
  ["google_ads", "Google Ads"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["linkedin", "LinkedIn"],
  ["pinterest", "Pinterest"],
];
const recordFields = {
  campaign: [
    { key: "name", label: "שם הקמפיין", required: true, step: 0 },
    { key: "objective", label: "מה רוצים להשיג?", required: true, step: 0 },
    {
      key: "product",
      label: "מה מפרסמים?",
      type: "textarea",
      required: true,
      step: 1,
    },
    {
      key: "audience",
      label: "למי רוצים להגיע?",
      type: "textarea",
      required: true,
      step: 2,
    },
    {
      key: "platform",
      label: "איפה מפרסמים?",
      options: platforms,
      default: "meta",
      step: 3,
    },
    { key: "budget", label: "מה התקציב המתוכנן?", type: "number", step: 4 },
    { key: "currency", label: "מטבע", default: "ILS", step: 4 },
    { key: "startDate", label: "תאריך התחלה", type: "date", step: 4 },
    { key: "endDate", label: "תאריך סיום", type: "date", step: 4 },
    {
      key: "assetIds",
      label: "מזהי מדיה מהספרייה, מופרדים בפסיקים",
      type: "ids",
      step: 5,
    },
    { key: "headline", label: "כותרת המודעה", step: 5 },
    { key: "copy", label: "טקסט המודעה", type: "textarea", step: 5 },
  ],
  post: [
    { key: "name", label: "שם הטיוטה", required: true },
    {
      key: "contentType",
      label: "סוג תוכן",
      options: [["post", "פוסט"], ["reel", "Reel"], ["story", "סטורי"], ["carousel", "קרוסלה"]],
      default: "post",
    },
    {
      key: "platform",
      label: "פלטפורמה",
      options: [["instagram", "Instagram"], ["facebook", "Facebook"], ["both", "Instagram ו־Facebook"], ...platforms],
      default: "both",
    },
    { key: "topic", label: "נושא הפוסט" },
    { key: "product", label: "מוצר או שירות", type: "textarea" },
    {
      key: "creationMode",
      label: "אופן יצירה",
      options: [["manual", "כתיבה ועריכה ידנית"], ["ai", "בריף להכנה באמצעות AI — ללא יצירה או חיוב אוטומטיים"]],
      default: "manual",
    },
    { key: "text", label: "תוכן הפוסט", type: "textarea", wide: true },
    { key: "assetIds", label: "מזהי מדיה, מופרדים בפסיקים", type: "ids" },
    { key: "scheduledAt", label: "מועד מתוכנן", type: "datetime-local" },
    {
      key: "status",
      label: "מצב",
      options: [
        ["DRAFT", "טיוטה"],
        ["SCHEDULED", "מתוכנן — לא נשלח אוטומטית"],
      ],
      default: "DRAFT",
    },
  ],
  appointment: [
    { key: "name", label: "שם הפגישה", required: true },
    { key: "leadId", label: "מזהה ליד" },
    { key: "scheduledAt", label: "מועד הפגישה", type: "datetime-local" },
    { key: "notes", label: "הערות", type: "textarea" },
    {
      key: "status",
      label: "מצב",
      options: [
        ["OPEN", "פתוחה"],
        ["DONE", "התקיימה"],
        ["CANCELLED", "בוטלה"],
      ],
      default: "OPEN",
    },
  ],
  ticket: [
    { key: "name", label: "נושא הפנייה", required: true },
    { key: "text", label: "תיאור", type: "textarea" },
    {
      key: "status",
      label: "מצב",
      options: [
        ["OPEN", "פתוחה"],
        ["CLOSED", "סגורה"],
      ],
      default: "OPEN",
    },
  ],
  folder: [{ key: "name", label: "שם התיקייה", required: true }],
};
function editRecord(kind, row, defaults = {}) {
  const values = { ...defaults, ...row?.payload };
  if (values.assetIds) values.assetIds = values.assetIds.join(",");
  for (const k of ["startDate", "endDate"])
    if (values[k]) values[k] = values[k].slice(0, 10);
  if (values.scheduledAt)
    values.scheduledAt = new Date(
      new Date(values.scheduledAt).getTime() -
        new Date().getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
  form(
    row ? "עריכה" : "יצירה חדשה",
    recordFields[kind],
    values,
    async (p) => {
      for (const k of ["leadId", "scheduledAt", "startDate", "endDate"])
        if (!p[k]) delete p[k];
      if (row) {
        p.status = p.status || row.payload.status;
        await api("/records/" + kind + "/" + row.id, "PUT", {
          payload: p,
          revision: row.revision,
        });
      } else await api("/records/" + kind, "POST", p);
    },
    kind === "campaign",
  );
}
async function recordsPage(kind) {
  const data = await api("/records/" + kind + "?offset=" + offset);
  $("toolbar").append(button(kind === "post" ? "פוסט חדש" : "יצירה חדשה", () => editRecord(kind), true));
  if (kind === "campaign")
    $("body").append(
      note(
        "שמירה יוצרת טיוטה מקומית בלבד. בקשת בדיקה תועבר למנגנון האישורים הקיים של Meta. אין במסך פעולה שמפעילה קמפיין או משנה תקציב.",
      ),
    );
  if (kind === "post")
    $("body").append(
      note(
        "ניתן להכין ולשמור בריף, טיוטה ומועד מתוכנן. בחירת AI שומרת בקשה בלבד ואינה מפעילה יצירה בתשלום. אין פרסום אוטומטי או שליחה לרשתות.",
      ),
    );
  const grid = el("div", {
    class: kind === "post" ? "module-calendar" : "module-grid",
  });
  for (const r of data.items) {
    const p = r.payload;
    grid.append(
      card(
        p.name,
        el("p", {}, p.text || p.product || p.notes || ""),
        el("span", { class: "module-badge" }, stateLabels[p.status] || "טיוטה"),
        p.scheduledAt
          ? el("p", {}, new Date(p.scheduledAt).toLocaleString("he-IL"))
          : null,
        actions(
          button("עריכה", () => editRecord(kind, r), true),
          button(
            "מחיקה",
            () =>
              confirmDialog("מחיקה", "למחוק את הרשומה?", () =>
                api("/records/" + kind + "/" + r.id, "DELETE", {
                  revision: r.revision,
                }),
              ),
            true,
          ),
          kind === "campaign"
            ? button(
                "שכפול",
                () => {
                  const copy = {
                    ...p,
                    name: p.name + " — עותק",
                    status: "DRAFT",
                  };
                  return api("/records/campaign", "POST", copy).then(render);
                },
                true,
              )
            : null,
          kind === "campaign" && p.status === "DRAFT"
            ? button(
                "בקשת בדיקה",
                () =>
                  confirmDialog(
                    "בדיקת טיוטה",
                    "הטיוטה תישלח לבדיקה במנגנון הקיים. לא נוצר או מופעל קמפיין אצל הספק.",
                    () =>
                      api("/campaigns/" + r.id + "/review", "POST", {
                        revision: r.revision,
                      }),
                  ),
                true,
              )
            : null,
        ),
      ),
    );
  }
  $("body").append(data.items.length ? grid : empty());
  pager(data);
}
const connectionStatus = {
  requires_configuration: "נדרשת הגדרה",
  not_connected: "לא מחובר",
  connected: "מחובר",
  selection_required: "יש לבחור חשבון",
  expired: "החיבור פג תוקף",
  sync_error: "שגיאת סנכרון",
};
async function connect(provider) {
  if (["wordpress", "woocommerce"].includes(provider)) {
    form(
      "חיבור אתר מאושר",
      [
        { key: "site", label: "כתובת האתר (HTTPS)", required: true },
        {
          key: "username",
          label: provider === "wordpress" ? "שם משתמש" : "Consumer Key",
          required: true,
        },
        {
          key: "password",
          label:
            provider === "wordpress"
              ? "Application Password"
              : "Consumer Secret",
          type: "password",
          required: true,
        },
      ],
      {},
      (d) => api("/connections/" + provider + "/connect", "POST", d),
    );
    return;
  }
  if (provider === "shopify") {
    form(
      "חיבור Shopify",
      [
        {
          key: "shop",
          label: "כתובת החנות: example.myshopify.com",
          required: true,
        },
      ],
      {},
      async (d) => {
        const r = await api("/connections/shopify/connect", "POST", d);
        location.assign(r.url);
      },
    );
    return;
  }
  const r = await api("/connections/" + provider + "/connect", "POST", {});
  location.assign(r.url);
}
async function connectionsPage() {
  const data = await api("/connections");
  $("body").append(
    note(
      "מצב חיבור אינו הוכחה שהרשאות פרסום אושרו. סנכרון קורא נתונים בלבד; אישורי ספק וחידוש הרשאות נעשים במסך הספק.",
    ),
    el(
      "div",
      { class: "module-grid" },
      data.items.map((p) =>
        card(
          p.name,
          el(
            "p",
            { class: "module-badge" },
            connectionStatus[p.status] || p.status,
          ),
          el("p", {}, p.accountId || p.displayName || "לא נבחר חשבון"),
          el(
            "p",
            { class: "module-muted" },
            p.lastSyncedAt
              ? "סנכרון אחרון: " +
                  new Date(p.lastSyncedAt).toLocaleString("he-IL")
              : "לא בוצע סנכרון במודול",
          ),
          p.scopes ? el("small", {}, "הרשאות: " + p.scopes) : null,
          actions(
            button(
              p.status === "expired" ? "חידוש חיבור" : "התחברות",
              () => connect(p.id),
              true,
            ),
            button(
              "סנכרון",
              async () => {
                const result = await api(
                  "/connections/" + p.id + "/sync",
                  "POST",
                  {},
                );
                show(
                  "נתוני " + p.name,
                  el(
                    "div",
                    {},
                    note(
                      "מוצגים נתוני התשובה המוגבלת מהספק. זו אינה תמונת מצב מלאה של כל החשבון.",
                    ),
                    el(
                      "pre",
                      { class: "module-pre" },
                      JSON.stringify(result, null, 2),
                    ),
                  ),
                );
              },
              true,
            ),
            button(
              "ניתוק",
              () =>
                confirmDialog(
                  "ניתוק " + p.name,
                  "ההרשאה המקומית תוסר. ביטול הרשאות אצל הספק נעשה בנפרד במסך הספק.",
                  () => api("/connections/" + p.id + "/disconnect", "POST", {}),
                ),
              true,
            ),
          ),
          p.accounts?.length
            ? el(
                "div",
                {},
                el("p", {}, "בחירת חשבון מורשה"),
                p.accounts.map((a) =>
                  button(
                    a.name || a.id,
                    async () => {
                      await api("/connections/" + p.id + "/select", "POST", {
                        accountId: a.id,
                      });
                      await render();
                    },
                    true,
                  ),
                ),
              )
            : null,
        ),
      ),
    ),
  );
}
async function mediaPage() {
  const [data, folders] = await Promise.all([
    api("/media?offset=" + offset + "&q=" + encodeURIComponent(search)),
    api("/records/folder"),
  ]);
  const upload = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp,video/mp4,video/webm",
      "aria-label": "בחירת קובץ מדיה",
    }),
    folder = el(
      "select",
      { "aria-label": "בחירת תיקייה" },
      el("option", { value: "" }, "ללא תיקייה"),
      folders.items.map((f) => el("option", { value: f.id }, f.payload.name)),
    );
  $("toolbar").append(
    upload,
    folder,
    button(
      "העלאה",
      async () => {
        const file = upload.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw { code: "FILE_TOO_LARGE" };
        await api(
          "/media?name=" +
            encodeURIComponent(file.name) +
            (folder.value ? "&folder=" + folder.value : ""),
          "POST",
          file,
          true,
        );
        await render();
      },
      true,
    ),
    button("תיקייה חדשה", () => editRecord("folder"), true),
    button("יצירה באמצעות AI", generateDialog, true),
  );
  $("body").append(
    note(
      "תמונות נבדקות ונשמרות מחדש. עד 20MB לקובץ ו־200MB לעסק. יצירת AI דורשת ספק פעיל, קרדיטים ואישור עלות.",
    ),
    el(
      "div",
      { class: "module-grid" },
      data.items.map((a) =>
        card(
          a.name,
          a.mime.startsWith("image/")
            ? el("img", {
                src: base + "/media/" + a.id + "/file",
                alt: a.name,
                class: "module-media",
                loading: "lazy",
              })
            : el("video", {
                src: base + "/media/" + a.id + "/file",
                controls: true,
                class: "module-media",
                preload: "metadata",
              }),
          el("small", {}, "מזהה מדיה: " + a.id),
          actions(
            button(
              "שינוי שם",
              () =>
                form(
                  "שינוי שם",
                  [{ key: "name", label: "שם", required: true }],
                  a,
                  (d) => api("/media/" + a.id, "PATCH", d),
                ),
              true,
            ),
            button(
              "מחיקה",
              () =>
                confirmDialog("מחיקת מדיה", "למחוק את הקובץ מהספרייה?", () =>
                  api("/media/" + a.id, "DELETE", {}),
                ),
              true,
            ),
          ),
        ),
      ),
    ),
  );
  if (!data.items.length) $("body").append(empty());
  const jobs = await api("/ai/jobs");
  $("body").append(
    card(
      "בקשות יצירה",
      jobs.items.length
        ? jobs.items.map((j) =>
            el(
              "div",
              {},
              el(
                "p",
                {},
                ({ image: "תמונה", text: "טקסט", video: "וידאו" }[j.kind] ||
                  "יצירה") +
                  " · " +
                  (stateLabels[j.status] || "נדרש בירור"),
              ),
              j.output ? el("p", {}, j.output) : null,
              j.error_code
                ? note("תוצאת הספק אינה ודאית; הקרדיט נשמר לבירור.")
                : null,
            ),
          )
        : empty(),
    ),
  );
  pager(data);
}
function generateDialog() {
  form(
    "יצירה באמצעות AI — עלות קרדיט אחד",
    [
      {
        key: "kind",
        label: "סוג יצירה",
        options: [
          ["image", "תמונה"],
          ["text", "טקסט"],
          ["video", "וידאו — דורש ספק מוגדר"],
        ],
      },
      { key: "prompt", label: "תיאור", type: "textarea", required: true },
      {
        key: "costApproval",
        label:
          "אישור עלות: קרדיט אחד ועלות ספק אפשרית. תוצאה לא ודאית דורשת בירור.",
        options: [
          ["no", "לא מאשר"],
          ["yes", "אני מאשר את עלות היצירה"],
        ],
        default: "no",
      },
    ],
    {},
    async (data) => {
      if (data.costApproval !== "yes")
        throw { code: "EXPLICIT_CONFIRMATION_REQUIRED" };
      delete data.costApproval;
      const r = await api("/ai/generate", "POST", {
        ...data,
        confirmCost: true,
        idempotencyKey: crypto.randomUUID(),
      });
      if (r.status !== "COMPLETE") throw { code: "AI_RESULT_UNCERTAIN" };
    },
  );
}
async function billingPage() {
  const data = await api("/billing");
  $("body").append(
    note(
      "תשלומים בסביבת בדיקה בלבד. אין חיובים אמיתיים. המחירים מופיעים רק לאחר הגדרת חבילות על ידי מנהל החיובים.",
    ),
    card(
      "הקרדיטים שלי",
      el("p", { class: "module-count" }, data.balance),
      data.configured
        ? el("p", {}, "Stripe Sandbox מוגדר")
        : empty("Stripe Sandbox עדיין לא הוגדר."),
    ),
  );
  if (me.billingAdmin)
    $("toolbar").append(
      button(
        "חבילה חדשה",
        () =>
          form(
            "הגדרת חבילה",
            [
              { key: "name", label: "שם חבילה", required: true },
              {
                key: "amount",
                label: "מחיר ביחידות המטבע הקטנות",
                type: "number",
              },
              { key: "currency", label: "מטבע באותיות קטנות", required: true },
              {
                key: "interval",
                label: "מחזור",
                options: [
                  ["month", "חודשי"],
                  ["year", "שנתי"],
                ],
              },
              { key: "credits", label: "קרדיטים למחזור", type: "number" },
            ],
            {},
            (d) => api("/billing/plans", "POST", d),
          ),
        true,
      ),
    );
  $("body").append(
    el(
      "div",
      { class: "module-grid" },
      data.plans.map((p) =>
        card(
          p.name,
          el(
            "p",
            {},
            money(p.amount, p.currency) +
              " / " +
              (p.interval === "month" ? "חודש" : "שנה"),
          ),
          el("p", {}, p.credits + " קרדיטים למחזור"),
          button(
            "בחירה בסביבת בדיקה",
            () =>
              confirmDialog(
                "פתיחת תשלום בדיקה",
                "תועבר למסך Stripe Sandbox עבור החבילה שנבחרה.",
                async () => {
                  const r = await api("/billing/checkout", "POST", {
                    planId: p.id,
                    confirm: true,
                  });
                  location.assign(r.url);
                },
              ),
            true,
          ),
        ),
      ),
    ),
  );
  if (!data.plans.length) $("body").append(empty("לא הוגדרו חבילות."));
  $("body").append(
    card(
      "המנויים שלי",
      data.subscriptions.length
        ? data.subscriptions.map((s) =>
            el(
              "div",
              {},
              el(
                "p",
                {},
                s.plan_snapshot.name +
                  " · " +
                  (stateLabels[s.status] || "נדרש בירור"),
              ),
              button(
                "בקשת ביטול בסוף מחזור",
                () =>
                  confirmDialog(
                    "ביטול מנוי בדיקה",
                    "הביטול יוגדר לסוף מחזור החיוב בסביבת הבדיקה.",
                    () =>
                      api("/billing/" + s.id + "/cancel", "POST", {
                        confirm: true,
                      }),
                  ),
                true,
              ),
            ),
          )
        : empty(),
    ),
    card(
      "היסטוריית שימוש",
      data.ledger.length
        ? table(
            ["תאריך", "שינוי", "סיבה"],
            data.ledger.map((r) => [
              new Date(r.created_at).toLocaleString("he-IL"),
              r.delta,
              {
                SANDBOX_INVOICE: "חשבונית בדיקה",
                AI_RESERVATION: "בקשת יצירה",
              }[r.reason] || "עדכון קרדיטים",
            ]),
          )
        : empty(),
    ),
  );
}
const businessFields = [
  { key: "name", label: "שם העסק" },
  { key: "industry", label: "תחום פעילות" },
  { key: "description", label: "תיאור העסק", type: "textarea", wide: true },
  { key: "website", label: "כתובת אתר", type: "url" },
  { key: "phone", label: "טלפון" },
  { key: "email", label: "אימייל", type: "email" },
  { key: "address", label: "כתובת" },
  { key: "hours", label: "שעות פעילות" },
  { key: "audience", label: "קהל יעד", type: "textarea" },
  { key: "products", label: "מוצרים", type: "textarea" },
  { key: "services", label: "שירותים", type: "textarea" },
  { key: "primary", label: "צבע מותג ראשי (HEX)", default: "#17654e" },
  { key: "secondary", label: "צבע משני (HEX)", default: "#153d30" },
  { key: "font", label: "גופן" },
  { key: "voice", label: "סגנון כתיבה" },
  { key: "guidelines", label: "הנחיות מותג", type: "textarea" },
];
async function businessPage() {
  const data = await api("/business"),
    p = data.payload;
  $("toolbar").append(
    button(
      "עריכת פרטי העסק",
      () =>
        form(
          "פרטי העסק ומיתוג",
          businessFields,
          { ...p, ...p.brand },
          async (d) => {
            const brand = {};
            for (const k of [
              "primary",
              "secondary",
              "font",
              "voice",
              "guidelines",
            ]) {
              brand[k] = d[k];
              delete d[k];
            }
            await api("/business", "PUT", {
              payload: { ...p, ...d, brand },
              revision: data.revision,
            });
          },
        ),
      true,
    ),
  );
  $("body").append(
    card(
      p.name || "פרטי העסק",
      Object.entries(p)
        .filter(([k]) => !["brand", "stages"].includes(k))
        .map(([k, v]) =>
          el(
            "p",
            {},
            (businessFields.find((f) => f.key === k)?.label || k) + ": " + v,
          ),
        ),
    ),
    card(
      "מיתוג",
      Object.entries(p.brand || {}).map(([k, v]) =>
        el(
          "p",
          {},
          (businessFields.find((f) => f.key === k)?.label || k) + ": " + v,
        ),
      ),
    ),
    note(
      "ניהול חברי צוות, רישום משתמשים ומעבר בין עסקים עדיין דורשים הרחבת מנגנון המשתמשים הקיים. שמות אחראים בלידים הם תוויות, ואינם מקנים הרשאות.",
    ),
  );
}
async function tasksPage() {
  const data = await legacy("/tasks");
  $("toolbar").append(
    button(
      "משימה חדשה",
      () =>
        form(
          "משימה חדשה",
          [
            { key: "title", label: "משימה", required: true },
            { key: "due_at", label: "תאריך יעד", type: "date" },
          ],
          {},
          (d) =>
            legacy("/tasks", "POST", {
              title: d.title,
              due_at: d.due_at || null,
            }),
        ),
      true,
    ),
    button("פגישה חדשה", () => editRecord("appointment"), true),
  );
  $("body").append(
    card(
      "משימות",
      data.items.length
        ? data.items.map((t) =>
            el(
              "div",
              {},
              el(
                "p",
                {},
                t.title + " · " + (t.status === "DONE" ? "הושלמה" : "פתוחה"),
              ),
              button(
                t.status === "DONE" ? "פתיחה מחדש" : "סימון כהושלמה",
                async () => {
                  await legacy("/tasks/" + t.id, "PATCH", {
                    status: t.status === "DONE" ? "OPEN" : "DONE",
                  });
                  await render();
                },
                true,
              ),
            ),
          )
        : empty(),
    ),
  );
  const appts = await api("/records/appointment");
  $("body").append(
    card(
      "פגישות",
      appts.items.length
        ? appts.items.map((r) =>
            el(
              "div",
              {},
              el(
                "p",
                {},
                r.payload.name +
                  " · " +
                  (r.payload.scheduledAt
                    ? new Date(r.payload.scheduledAt).toLocaleString("he-IL")
                    : ""),
              ),
              button("עריכה", () => editRecord("appointment", r), true),
            ),
          )
        : empty(),
    ),
  );
}
async function knowledgePage() {
  $("body").append(
    el(
      "div",
      { class: "module-grid" },
      card(
        "חיבורים",
        "התחבר דרך ספק השירות, אשר רק הרשאות נדרשות ובחר חשבון. חיבור שפג תוקפו דורש חידוש. הנתונים המוצגים בסנכרון עשויים לכלול עמוד ראשון בלבד.",
      ),
      card(
        "לידים",
        "אפשר לייבא CSV עם name,phone,email,notes,source. כפילויות לפי טלפון או אימייל מדולגות בזמן ייבוא. מיזוג מפורש מעביר הערות ומוחק את הרשומה הכפולה.",
      ),
      card(
        "טיוטות ואישורים",
        "שמירת טיוטה אינה הפעלת פרסום. בקשת בדיקה של טיוטת Meta יוצרת בקשה במנגנון הקיים, ללא אישור ביצוע וללא הפעלת קמפיין.",
      ),
      card(
        "מדיה ויצירה",
        "העלאה מחייבת הרשאת בעלים. יצירת AI מחייבת ספק מוגדר וקרדיטים. וידאו ופרסום אוטומטי אינם זמינים ללא מימוש ספק מתאים.",
      ),
      card(
        "מנויים",
        "המערכת החדשה מוגבלת ל־Stripe Sandbox. זיכוי קרדיטים מתבצע רק לאחר אימות webhook של חשבונית ששולמה.",
      ),
    ),
  );
}
async function activityPage() {
  const overview = await legacy("/overview");
  $("body").append(
    overview.activity.length
      ? table(
          ["תאריך", "אירוע", "תוצאה"],
          overview.activity.map((a) => [
            new Date(a.created_at).toLocaleString("he-IL"),
            a.event,
            a.result,
          ]),
        )
      : empty(),
  );
}
function loginUI() {
  $("workspace").hidden = true;
  $("login").hidden = false;
  $("logout").hidden = true;
}
async function render() {
  if (!me) return;
  const page = location.hash.slice(1).split("?")[0] || "connections";
  $("heading").textContent = pages[page] || pages.connections;
  $("body").replaceChildren(empty("טוען…"));
  $("toolbar").replaceChildren();
  document
    .querySelectorAll("#nav a")
    .forEach((a) =>
      a.setAttribute("aria-current", a.hash === "#" + page ? "page" : "false"),
    );
  try {
    $("body").replaceChildren();
    if (page === "crm") await crm();
    else if (page === "campaigns") await recordsPage("campaign");
    else if (page === "posts") await recordsPage("post");
    else if (page === "media") await mediaPage();
    else if (page === "connections") await connectionsPage();
    else if (page === "billing") await billingPage();
    else if (page === "business") await businessPage();
    else if (page === "tasks") await tasksPage();
    else if (page === "support") {
      await recordsPage("ticket");
      $("body").prepend(
        note(
          "הפניות נשמרות בעסק. אין עדיין שירות שמודיע לצוות התמיכה או מנגנון SLA.",
        ),
      );
    } else if (page === "knowledge") await knowledgePage();
    else if (page === "activity") await activityPage();
    else if (page === "settings")
      $("body").append(
        card(
          "הגדרות משתמש",
          el(
            "a",
            { class: "button", href: "/app/settings" },
            "פתיחת ההגדרות הקיימות",
          ),
        ),
      );
    else await connectionsPage();
  } catch (e) {
    $("body").replaceChildren(empty("המידע אינו זמין כרגע."));
    error(e);
  }
}
async function enter() {
  me = await api("/me");
  $("login").hidden = true;
  $("workspace").hidden = false;
  $("logout").hidden = false;
  $("nav").replaceChildren(
    ...Object.entries(pages).map(([id, name]) =>
      el("a", { href: "#" + id }, name),
    ),
  );
  await render();
}
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const input = e.currentTarget.elements.token;
    await legacy("/login", "POST", { token: input.value });
    input.value = "";
    await enter();
  } catch (err) {
    error(err);
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await legacy("/logout", "POST", {});
    me = null;
    loginUI();
  } catch (e) {
    error(e);
  }
});
window.addEventListener("hashchange", () => {
  offset = 0;
  search = "";
  render();
});
enter().catch((e) => {
  loginUI();
  if (e.code !== "LOGIN_REQUIRED") error(e);
});
