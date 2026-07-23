export function reservationSummary(manifest) {
  const reservations = Array.isArray(manifest?.reserved) ? manifest.reserved : [];
  return { reservas: reservations.length, falhas_criacao: reservations.filter((item) => item.status === 'falha_na_criacao').length, cancelados: reservations.filter((item) => item.status === 'cancelado_sem_reuso').length };
}