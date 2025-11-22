"use client";
import Header from "../components/header";

export default function TheHedgePage() {
  return (
    <main className="min-h-screen bg-neutral-900 text-white px-6 py-8">
      <Header title="The Hedge" />
      <div className="bg-neutral-800 rounded-2xl p-6 border border-neutral-700">
        <p className="text-gray-300">
          Placeholder — portfolio optimizer and risk-balanced mix will live here.
        </p>
      </div>
    </main>
  );
}
