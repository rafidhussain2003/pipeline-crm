const GRAPH_VERSION = "v19.0";

type FbFieldData = { name: string; values: string[] };

export async function fetchFacebookLead(leadgenId: string, pageAccessToken: string) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?access_token=${encodeURIComponent(
    pageAccessToken
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Facebook Graph API error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const fieldData: FbFieldData[] = data.field_data || [];

  const get = (key: string) =>
    fieldData.find((f) => f.name.toLowerCase().includes(key))?.values?.[0];

  return {
    name: get("full_name") || get("name") || [get("first_name"), get("last_name")].filter(Boolean).join(" "),
    phone: get("phone"),
    email: get("email"),
    raw: data,
  };
}
