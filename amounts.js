"use strict";
const MICRO_PER_SUN = 1000000;

function toMicro(value) {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  const match = text.match(/^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) throw new Error("Invalid SUN amount.");
  const fraction = match[2] || "";
  const exponent = Number(match[3] || 0);
  if (!Number.isSafeInteger(exponent) || exponent < -100 || exponent > 100) throw new Error("Invalid SUN amount.");
  const digits = BigInt((match[1] + fraction).replace(/^0+(?=\d)/, "") || "0");
  const scale = fraction.length - exponent;
  let micros;
  if (scale <= 6) micros = digits * (10n ** BigInt(6 - scale));
  else {
    const divisor = 10n ** BigInt(scale - 6);
    if (digits % divisor !== 0n) throw new Error("SUN amount has more than 6 decimal places.");
    micros = digits / divisor;
  }
  if (micros < 0n || micros > 9000000000000n) throw new Error("Invalid SUN amount.");
  return Number(micros);
}

module.exports = { MICRO_PER_SUN, toMicro };
