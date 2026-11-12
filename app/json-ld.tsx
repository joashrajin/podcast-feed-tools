/** Structured data for search engines. `<` is escaped so text can't close the script. */
export default function JsonLd({ items }: { items: object[] }) {
  const data = { "@context": "https://schema.org", "@graph": items };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
