import { h } from "./dom.js";

/** Render a tool's options schema. Returns { el, values(), validate() }. */
export function optionsForm(schema = []) {
  const state = {};
  const rows = new Map();
  for (const o of schema) state[o.key] = o.default ?? (o.type === "checkbox" ? false : "");

  const refresh = () => {
    for (const [o, row] of rows) {
      let show = true;
      if (o.showIf) {
        for (const [k, v] of Object.entries(o.showIf)) {
          const want = Array.isArray(v) ? v : [v];
          if (!want.map(String).includes(String(state[k]))) show = false;
        }
      }
      row.hidden = !show;
    }
  };

  const el = h("div", {});
  for (const o of schema) {
    let control;
    const set = (v) => {
      state[o.key] = v;
      refresh();
    };
    if (o.type === "radio") {
      control = h(
        "div",
        { class: "radios", role: "radiogroup", "aria-label": o.label },
        o.choices.map(([val, text]) =>
          h(
            "label",
            {},
            h("input", { type: "radio", name: o.key, value: String(val), checked: String(val) === String(o.default), onchange: () => set(val) }),
            h("span", {}, text)
          )
        )
      );
    } else if (o.type === "checkbox") {
      control = h("label", { class: "check-row" }, h("input", { type: "checkbox", checked: !!o.default, onchange: (e) => set(e.target.checked) }), h("span", {}, o.label));
    } else if (o.type === "range") {
      const out = h("span", { class: "muted", style: "font-size:13px" }, String(o.default));
      control = h(
        "div",
        {},
        h("input", {
          type: "range",
          min: o.min,
          max: o.max,
          step: o.step,
          value: o.default,
          "aria-label": o.label,
          oninput: (e) => {
            set(Number(e.target.value));
            out.textContent = e.target.value;
          },
        }),
        out
      );
    } else if (o.type === "password" && o.confirm) {
      const a = h("input", { type: "password", autocomplete: "new-password", placeholder: "Password", "aria-label": o.label, oninput: (e) => set(e.target.value) });
      const b = h("input", { type: "password", autocomplete: "new-password", placeholder: "Repeat password", "aria-label": `${o.label} again`, style: "margin-top:6px", oninput: (e) => (state[`${o.key}__confirm`] = e.target.value) });
      control = h("div", {}, a, b);
    } else {
      control = h("input", {
        type: o.type === "number" ? "number" : o.type === "color" ? "color" : o.type === "password" ? "password" : "text",
        value: o.default ?? "",
        placeholder: o.placeholder || "",
        min: o.min,
        max: o.max,
        "aria-label": o.label,
        autocomplete: o.type === "password" ? "current-password" : "off",
        oninput: (e) => set(o.type === "number" ? Number(e.target.value) : e.target.value),
      });
    }
    const row = o.type === "checkbox" ? h("div", { class: "opt" }, control) : h("div", { class: "opt" }, h("label", {}, o.label), control, o.hint && h("div", { class: "hintline" }, o.hint));
    rows.set(o, row);
    el.append(row);
  }
  refresh();

  return {
    el,
    values: () => ({ ...state }),
    set(key, value) {
      state[key] = value;
      const r = el.querySelector(`input[type=radio][name="${key}"][value="${String(value)}"]`);
      if (r) r.checked = true;
      refresh();
    },
    validate() {
      for (const [o, row] of rows) {
        if (row.hidden) continue;
        if (o.required && !String(state[o.key] ?? "").trim()) return `${o.label} is required.`;
        if (o.confirm && state[o.key] !== (state[`${o.key}__confirm`] ?? "")) return "The passwords do not match.";
      }
      return null;
    },
  };
}
