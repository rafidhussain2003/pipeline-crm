import { getPublicHostedForm, type FormField } from "@/lib/website";
import { checkFeature } from "@/lib/features";
import { getPublicAppUrl } from "@/lib/url";

// Public hosted-form page (Phase 8). Server-rendered so it works even with JS
// disabled (a plain <form> POST to /api/forms/[publicKey] → 303 redirect), and
// progressively enhanced by /sdk/forms.js (honeypot, nonce/replay, JSON submit,
// inline success). No auth: it's a public form. It reuses the SAME public
// submission endpoint and ingestInboundLead pipeline as every embedded form.

export const dynamic = "force-dynamic";

// Email/phone submit under canonical keys so the source's default field mapping
// (name/phone/email) always resolves them; other fields keep their own name and
// are preserved verbatim on the lead's raw payload.
function submitKey(f: FormField): string {
  if (f.type === "email") return "email";
  if (f.type === "phone") return "phone";
  return f.name;
}

function Field({ f }: { f: FormField }) {
  const key = submitKey(f);
  const base = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none";
  const label = (
    <label htmlFor={`f_${f.name}`} className="block text-sm font-medium text-slate-700 mb-1">
      {f.label}
      {f.required && <span className="text-red-500"> *</span>}
    </label>
  );
  if (f.type === "textarea") {
    return (
      <div>
        {label}
        <textarea id={`f_${f.name}`} name={key} rows={4} required={f.required} placeholder={f.placeholder} className={base} />
      </div>
    );
  }
  if (f.type === "dropdown") {
    return (
      <div>
        {label}
        <select id={`f_${f.name}`} name={key} required={f.required} defaultValue="" className={base}>
          <option value="" disabled>
            {f.placeholder || "Select…"}
          </option>
          {(f.options || []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (f.type === "checkbox") {
    return (
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input id={`f_${f.name}`} type="checkbox" name={key} value="yes" required={f.required} className="mt-0.5" />
        <span>
          {f.label}
          {f.required && <span className="text-red-500"> *</span>}
        </span>
      </label>
    );
  }
  const inputType = f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text";
  return (
    <div>
      {label}
      <input id={`f_${f.name}`} type={inputType} name={key} required={f.required} placeholder={f.placeholder} className={base} />
    </div>
  );
}

export default async function HostedFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  const form = await getPublicHostedForm(formId);

  // Phase 18: a public page carries no session, so entitlement comes from the
  // form's company. Disabled = the same "not available" screen as a deleted
  // form — visitors learn nothing about the tenant's subscription.
  const enabled = form ? await checkFeature(form.companyId, "website_forms") : false;

  if (!form || !enabled) {
    return (
      <main className="min-h-full flex items-center justify-center bg-slate-50 p-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-900">Form not available</h1>
          <p className="text-sm text-slate-500 mt-1">This form is inactive or no longer exists.</p>
        </div>
      </main>
    );
  }

  const fields = (form.fields as FormField[]) || [];
  const action = `${getPublicAppUrl()}/api/forms/${form.publicKey}`;

  return (
    <main className="min-h-full flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h1 className="text-xl font-semibold text-slate-900 mb-5">{form.name}</h1>
        <form
          action={action}
          method="post"
          data-ziplod-form={form.publicKey}
          {...(form.successMessage ? { "data-ziplod-success": form.successMessage } : {})}
          {...(form.redirectUrl ? { "data-ziplod-redirect": form.redirectUrl } : {})}
          className="space-y-4"
        >
          {fields.map((f, i) => (
            <Field key={`${f.name}_${i}`} f={f} />
          ))}
          <button type="submit" className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-slate-800">
            {form.submitText}
          </button>
        </form>
        <p className="text-[11px] text-slate-400 mt-4 text-center">Protected against spam. Powered by Ziplod.</p>
      </div>
      {/* Progressive enhancement: honeypot + replay nonce + JSON submit + inline success. */}
      <script src={`${getPublicAppUrl()}/sdk/forms.js`} data-key={form.publicKey} async />
    </main>
  );
}
