const INTERACTIVE =
  "a[href],button,input,select,textarea,summary,[role=button],[role=link]," +
  "[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=combobox]," +
  "[role=switch],[role=option],[contenteditable=true],[onclick]";

export const SCAN = `(() => {
  const ATTR = "data-workmates-ref";
  for (const old of document.querySelectorAll("[" + ATTR + "]")) old.removeAttribute(ATTR);

  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    if (el.closest("[aria-hidden=true]")) return false;
    return true;
  };

  const name = (el) => {
    const label = el.getAttribute("aria-label");
    if (label) return label.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const parts = by.split(/\\s+/).map((id) => document.getElementById(id)?.innerText ?? "");
      const joined = parts.join(" ").trim();
      if (joined) return joined;
    }
    if (el.id) {
      const tied = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (tied?.innerText?.trim()) return tied.innerText.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping?.innerText?.trim()) return wrapping.innerText.trim();
    for (const attr of ["alt", "title", "placeholder", "value"]) {
      const found = el.getAttribute?.(attr);
      if (found?.trim()) return found.trim();
    }
    return (el.innerText || el.textContent || "").trim();
  };

  const role = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox" || type === "radio" || type === "submit" || type === "button") {
        return type === "submit" ? "button" : type;
      }
      return "textbox";
    }
    return tag;
  };

  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(${JSON.stringify(INTERACTIVE)})) {
    if (!visible(el)) continue;
    const ref = "e" + ++n;
    el.setAttribute(ATTR, ref);
    const entry = { ref, role: role(el), name: name(el).slice(0, 120).replace(/\\s+/g, " ") };
    if (el.disabled) entry.disabled = true;
    if (el.checked !== undefined && (el.type === "checkbox" || el.type === "radio")) {
      entry.checked = !!el.checked;
    }
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.value) {
      entry.value = String(el.value).slice(0, 80);
    }
    out.push(entry);
    if (n >= 250) break;
  }
  return { url: location.href, title: document.title, nodes: out };
})()`;

export const clickScript = (ref: string) => `(() => {
  const ref = ${JSON.stringify(ref)};
  const el = document.querySelector('[data-workmates-ref="' + ref + '"]');
  if (!el) return { error: "no element @" + ref + ". Take a fresh snapshot: the page has changed." };
  el.scrollIntoView({ block: "center", inline: "center" });
  const box = el.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return { error: "@" + ref + " is not visible on the page" };
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const at = document.elementFromPoint(x, y);
  if (at && at !== el && !el.contains(at) && !at.contains(el)) {
    const describe = (node) => {
      const label = (node.getAttribute?.("aria-label") || node.innerText || "").trim().slice(0, 60);
      return node.tagName.toLowerCase() + (label ? ' "' + label.replace(/\\s+/g, " ") + '"' : "");
    };
    return {
      covered: describe(at),
      hint: "dismiss it or act on it, then snapshot again.",
    };
  }
  return { ok: true, x, y };
})()`;

export const focusScript = (ref: string, clear: boolean) => `(() => {
  const ref = ${JSON.stringify(ref)};
  const el = document.querySelector('[data-workmates-ref="' + ref + '"]');
  if (!el) return { error: "no element @" + ref + ". Take a fresh snapshot." };
  el.scrollIntoView({ block: "center" });
  el.focus();
  ${
    clear
      ? `if ("value" in el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }
         else if (el.isContentEditable) { el.textContent = ""; }`
      : ""
  }
  return { ok: true };
})()`;

export const READ = `(() => {
  const clone = document.body.cloneNode(true);
  for (const junk of clone.querySelectorAll("script,style,noscript,svg,nav,footer")) junk.remove();
  const main = document.querySelector("main,article,[role=main]");
  const source = main ? main.cloneNode(true) : clone;
  for (const junk of source.querySelectorAll?.("script,style,noscript") ?? []) junk.remove();
  const text = (source.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
  return { url: location.href, title: document.title, text: text.slice(0, 24000) };
})()`;

export interface ScanNode {
  ref: string;
  role: string;
  name: string;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
}

export function formatSnapshot(scan: { url: string; title: string; nodes: ScanNode[] }): string {
  const lines = scan.nodes.map((node) => {
    const bits = [`@${node.ref}`, node.role];
    if (node.name) bits.push(JSON.stringify(node.name));
    if (node.value) bits.push(`value=${JSON.stringify(node.value)}`);
    if (node.checked !== undefined) bits.push(node.checked ? "checked" : "unchecked");
    if (node.disabled) bits.push("disabled");
    return "  " + bits.join(" ");
  });
  return [
    `${scan.title || "(untitled)"} — ${scan.url}`,
    lines.length ? `${lines.length} controls:` : "no controls found on this page",
    ...lines,
  ].join("\n");
}
