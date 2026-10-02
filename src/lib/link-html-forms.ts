// `stripNoisyHtml` drops every `<form>`, because on most pages a form is a search box, a
// newsletter sign-up or a login widget. An ASP.NET WebForms page is the exception: it wraps its
// whole body in one server form, recognisable by the `__VIEWSTATE` field the framework puts in
// it, and dropping that form drops the page. dLib.si is built this way, and its catalogue pages
// read as empty -- then, because the site's sign-in widget has a password field, as a login wall.

/** Removes the page's forms but keeps the contents of an ASP.NET WebForms page form. */
export function stripHtmlForms(html: string) {
  return html.replace(/<form\b[^>]*>([\s\S]*?)<\/form>/gi, (_form, inner: string) =>
    /\bname\s*=\s*["']__VIEWSTATE["']/i.test(inner) ? inner : " ",
  );
}
