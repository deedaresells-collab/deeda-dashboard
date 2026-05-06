const { getSupabaseConfig } = require("./_supabase");

module.exports = async function handler(req, res) {
  try {
    const { url, key } = getSupabaseConfig();
    const projectRef = new URL(url).hostname.split(".")[0];
    res.status(200).json({
      ok: true,
      supabaseProjectRef: projectRef,
      supabaseUrl: url,
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
      hasAnonKey: Boolean(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      keyPrefix: String(key || "").slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
