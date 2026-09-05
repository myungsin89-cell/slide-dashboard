import Script from "next/script";
import "./globals.css";

export const metadata = {
  title: "G배움 로그 - 실시간 구글 학습 과정평가 대시보드",
  description: "구글 슬라이드 및 독스를 활용한 실시간 과정 중심 평가 및 피드백 대시보드",
  icons: {
    icon: '/google-slides.svg',
    shortcut: '/google-slides.svg',
    apple: '/google-slides.svg',
  },
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
