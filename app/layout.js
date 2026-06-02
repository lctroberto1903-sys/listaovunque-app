import "./globals.css";

export const metadata = {
  title: "ListaOvunque Italia",
  description: "Pubblica i tuoi annunci su Vinted ed eBay in un click",
};

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
