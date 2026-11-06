export default function ConfigurationError({ message }) {
  return (
    <main className="configuration-screen">
      <section className="configuration-card">
        <p className="configuration-eyebrow">Setup needed</p>
        <h1>GroupTab needs its Firebase settings.</h1>
        <p>{message}</p>
        <p>Add the required <code>VITE_*</code> variables to this environment, then redeploy. Your trip data has not been changed.</p>
      </section>
    </main>
  );
}
