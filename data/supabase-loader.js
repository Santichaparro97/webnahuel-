/* =====================================================================
   SUPABASE LOADER
   Si SUPABASE_CONFIG está configurado, carga products + settings desde
   la DB y los expone como window.DATA (mismo shape que data.js legacy).
   Si no, deja el window.DATA del data.js embebido.
   ===================================================================== */

(function () {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url || cfg.url.includes('YOUR-PROJECT') || !window.supabase) {
    // Sin config Supabase → mantenemos window.DATA tal como vino del data.js legacy
    window.DATA_SOURCE = 'legacy';
    return;
  }

  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  window.__sb = sb;
  window.DATA_SOURCE = 'supabase';

  // Bloqueamos el inicio del app.js hasta que cargue de Supabase
  // app.js llama a init() que está esperando esta promesa via window.__supabaseDataReady
  window.__supabaseDataReady = (async () => {
    try {
      const [{ data: products }, { data: settings }] = await Promise.all([
        sb.from('products')
          .select('legacy_id, title, slug, category, brand, description, price, original_price, stock, handle_stock, images, featured, position')
          .eq('active', true)
          .order('position', { ascending: true })
          .limit(2000),
        sb.from('settings').select('key, value'),
      ]);

      const settingsObj = {};
      (settings || []).forEach(s => {
        let val = s.value;
        // si viene como string JSON, lo dejamos como string; supabase puede devolver JSONB ya parseado
        if (typeof val === 'string') val = val.replace(/^"|"$/g, '');
        settingsObj[s.key] = val;
      });

      // Adaptar shape para que el resto de la web no se entere
      window.DATA = {
        tenant: {
          title:        settingsObj.title || 'De La Ostia Perfumes',
          description:  settingsObj.tagline || 'Perfumería online de réplicas premium',
          highlight:    settingsObj.highlight || '',
          phone:        settingsObj.phone || '',
          instagram:    settingsObj.instagram || '',
          // Logo local circular (no depende de servidores externos)
          logo:         settingsObj.logo || 'disenio/favicon.png',
          banner:       settingsObj.banner || '',
        },
        products: (products || []).map(p => ({
          id: p.legacy_id || String(p.title),
          title: p.title,
          slug: p.slug,
          category: p.category,
          description: p.description || '',
          price: p.price,
          originalPrice: p.original_price || 0,
          currentStock: p.stock || 0,
          handleStock: p.handle_stock !== false,
          images: p.images || [],
          featured: p.featured === true,
          position: p.position || 0,
        })),
      };

      console.info(`[Supabase] Cargados ${window.DATA.products.length} productos en vivo.`);
    } catch (err) {
      console.error('[Supabase] Error cargando productos, usando data legacy:', err);
      window.DATA_SOURCE = 'legacy';
    }
  })();
})();
