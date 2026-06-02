"use client";
import { useState, useEffect, useRef } from "react";

const CONDITIONS = [
  { value: "nuovo", label: "Nuovo con etichetta" },
  { value: "ottimo", label: "Ottimo stato" },
  { value: "buono", label: "Buono stato" },
  { value: "discreto", label: "Discreto stato" },
  { value: "usato", label: "Usato" },
];

const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "Unica"];

const CATEGORIES = [
  { value: "donna", label: "Abbigliamento donna" },
  { value: "uomo", label: "Abbigliamento uomo" },
  { value: "bambini", label: "Bambini" },
  { value: "scarpe", label: "Scarpe" },
  { value: "borse", label: "Borse e zaini" },
  { value: "accessori", label: "Accessori" },
];

export default function Home() {
  const [form, setForm] = useState({
    title: "",
    description: "",
    price: "",
    category: "donna",
    size: "M",
    condition: "buono",
    brand: "",
    location: "",
  });
  const [photos, setPhotos] = useState([]);
  const [platforms, setPlatforms] = useState({ vinted: true, ebay: true });
  const [extensionActive, setExtensionActive] = useState(false);
  const [status, setStatus] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    if (document.documentElement.getAttribute("data-listaovunque-extension") === "active") {
      setExtensionActive(true);
    }
    const handler = () => setExtensionActive(true);
    document.addEventListener("listaovunque-extension-active", handler);
    return () => document.removeEventListener("listaovunque-extension-active", handler);
  }, []);

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handlePhotos = (e) => {
    const files = Array.from(e.target.files);
    const previews = files.map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    setPhotos((p) => [...p, ...previews].slice(0, 8));
  };

  const removePhoto = (i) => {
    setPhotos((p) => p.filter((_, idx) => idx !== i));
  };

  const togglePlatform = (key) => {
    setPlatforms((p) => ({ ...p, [key]: !p[key] }));
  };

  const listing = { ...form };

  const publishVinted = () => {
    return new Promise((resolve) => {
      if (!extensionActive) {
        resolve({ success: false, error: "Estensione non rilevata. Installa l'estensione ListaOvunque." });
        return;
      }
      window.postMessage({ type: "SAVE_LISTING", listing }, "*");
      const handler = (e) => {
        if (e.data?.type === "LISTING_SAVED") {
          window.removeEventListener("message", handler);
          resolve({ success: true, message: "Annuncio salvato! L'estensione aprirà Vinted." });
        }
      };
      window.addEventListener("message", handler);
      setTimeout(() => {
        window.removeEventListener("message", handler);
        resolve({ success: false, error: "Timeout: estensione non ha risposto." });
      }, 5000);
    });
  };

  const publishEbay = async () => {
    const formData = new FormData();
    formData.append("listing", JSON.stringify(listing));
    photos.forEach((p) => formData.append("photos", p.file));
    const res = await fetch("/api/ebay/publish", { method: "POST", body: formData });
    return res.json();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.price) {
      setStatus({ type: "error", message: "Titolo e prezzo sono obbligatori." });
      return;
    }
    if (!platforms.vinted && !platforms.ebay) {
      setStatus({ type: "error", message: "Seleziona almeno una piattaforma." });
      return;
    }
    setLoading(true);
    setResults([]);
    setStatus(null);

    const jobs = [];
    if (platforms.vinted) jobs.push(publishVinted().then((r) => ({ platform: "Vinted", ...r })));
    if (platforms.ebay) jobs.push(publishEbay().then((r) => ({ platform: "eBay", ...r })));

    const res = await Promise.all(jobs);
    setResults(res);
    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center text-white font-bold text-lg">L</div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">ListaOvunque Italia</h1>
          <p className="text-sm text-gray-500">Pubblica su più piattaforme in un click</p>
        </div>
        <div className="ml-auto">
          {extensionActive ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">✓ Estensione attiva</span>
          ) : (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full font-medium">⚠ Estensione non rilevata</span>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Piattaforme */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Pubblica su</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => togglePlatform("vinted")}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${
                platforms.vinted ? "border-teal-500 bg-teal-50 text-teal-700" : "border-gray-200 text-gray-400"
              }`}
            >
              👗 Vinted
            </button>
            <button
              type="button"
              onClick={() => togglePlatform("ebay")}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm border-2 transition-all ${
                platforms.ebay ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-400"
              }`}
            >
              🛒 eBay
            </button>
          </div>
        </div>

        {/* Foto */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Foto <span className="text-gray-400 font-normal">(max 8)</span></p>
          <div className="flex flex-wrap gap-2 mb-3">
            {photos.map((p, i) => (
              <div key={i} className="relative w-20 h-20">
                <img src={p.url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                >×</button>
              </div>
            ))}
            {photos.length < 8 && (
              <button
                type="button"
                onClick={() => fileRef.current.click()}
                className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 text-2xl hover:border-brand hover:text-brand transition-colors"
              >+</button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotos} className="hidden" />
        </div>

        {/* Dettagli */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm font-semibold text-gray-700">Dettagli annuncio</p>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Titolo *</label>
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="Es. Giacca invernale nera taglia M"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              required
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Descrizione</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={4}
              placeholder="Descrivi il prodotto: materiale, difetti, occasione d'uso..."
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Prezzo (€) *</label>
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={handleChange}
                placeholder="0.00"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Brand</label>
              <input
                name="brand"
                value={form.brand}
                onChange={handleChange}
                placeholder="Zara, H&M, Nike..."
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Categoria</label>
              <select
                name="category"
                value={form.category}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Taglia</label>
              <select
                name="size"
                value={form.size}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Condizione</label>
              <select
                name="condition"
                value={form.condition}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Città</label>
            <input
              name="location"
              value={form.location}
              onChange={handleChange}
              placeholder="Es. Milano"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
        </div>

        {/* Errore */}
        {status?.type === "error" && (
          <div className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3">{status.message}</div>
        )}

        {/* Risultati */}
        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((r) => (
              <div
                key={r.platform}
                className={`rounded-xl px-4 py-3 text-sm ${r.success ? "bg-green-50 text-green-800" : "bg-yellow-50 text-yellow-800"}`}
              >
                {r.success ? "✅" : "❌"} <strong>{r.platform}</strong>:{" "}
                {r.success ? (
                  r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="underline">Vedi annuncio →</a> : r.message
                ) : r.error}
              </div>
            ))}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand text-white font-bold py-4 rounded-2xl text-base hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Pubblicazione in corso..." : "🚀 Pubblica ora"}
        </button>
      </form>
    </div>
  );
}
