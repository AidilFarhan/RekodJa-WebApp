'use client';

export default function TodayDate() {
  const label = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  return <p className="eyebrow">{label}</p>;
}
