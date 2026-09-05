export default function MadeByStamp({ style = {}, className = '' }) {
  return (
    <footer 
      className={`site-stamp-footer no-print ${className}`} 
      style={style}
    >
      <span className="stamp-leaf" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
          <path d="M2 21c0-3 1.85-5.36 5.08-6"/>
        </svg>
      </span>
      <span>made by 초록덕후</span>
    </footer>
  );
}
