import { PDFDocument, result, baseName, loadDoc, saveDoc, ToolError, assemble } from "./core.js";

/** Add a password. Owner password defaults to the user password. */
export async function protect(files, { password = "", ownerPassword = "", allowPrinting = true, allowCopying = false, allowModifying = false } = {}) {
  const file = files[0];
  if (!password || password.length < 1) throw new ToolError("Enter a password.", "no_password");
  const doc = await loadDoc(file);
  doc.encrypt({
    userPassword: password,
    ownerPassword: ownerPassword || password,
    permissions: {
      printing: allowPrinting ? "highResolution" : false,
      copying: !!allowCopying,
      modifying: !!allowModifying,
      annotating: !!allowModifying,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: !!allowModifying,
    },
  });
  return result(`${baseName(file.name)}-protected.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

/** Remove a password you know: open with it, copy every page into a fresh file. */
export async function unlock(files, { password = "" } = {}) {
  const file = { ...files[0], password: password || files[0].password };
  const src = await loadDoc(file);
  if (!src.isEncrypted && !file.password) {
    throw new ToolError(`${file.name} is not password protected.`, "not_encrypted");
  }
  const doc = await assemble([file]);
  return result(`${baseName(files[0].name)}-unlocked.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
}

/** Flatten form fields so they become plain page content. */
export async function flatten(files) {
  const file = files[0];
  const doc = await loadDoc(file);
  let fields = 0;
  try {
    const form = doc.getForm();
    fields = form.getFields().length;
    if (fields) form.flatten();
  } catch (err) {
    throw new ToolError("This form could not be flattened: " + String(err?.message || err).slice(0, 120), "flatten_failed");
  }
  const r = result(`${baseName(file.name)}-flattened.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { fields };
  return r;
}

export { PDFDocument };
