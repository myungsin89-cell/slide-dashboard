import Script from "next/script";
import "./globals.css";

export const metadata = {
  title: "슬라이드 대시보드 - 과정 평가 피드백 대시보드",
  description: "구글 슬라이드를 활용한 실시간 과정 평가 및 피드백 대시보드",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body className="main-content">
        {children}
        {/* Google API Client Library */}
        <Script src="https://apis.google.com/js/api.js" strategy="beforeInteractive" />
        {/* Google Identity Services */}
        <Script src="https://accounts.google.com/gsi/client" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
