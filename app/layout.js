import { Inter } from "next/font/google";
import "./globals.css";
import "./compact-dashboard.css";
import ThemeProvider from "./ThemeProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Crypto Alerts Dashboard",
  description: "Real-time cryptocurrency alerts and market monitoring",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning={true}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
