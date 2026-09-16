"use strict";

const buildTrend = (dayWindow, trendBuckets, services) => {
  const counts = new Map();

  for (const bucket of trendBuckets) {
    const { y, m, d, service } = bucket._id;
    const key = `${y}-${m}-${d}`;
    const byService = counts.get(key) ?? new Map();
    byService.set(service, (byService.get(service) ?? 0) + bucket.count);
    counts.set(key, byService);
  }

  return dayWindow.map((slot) => {
    const byService = counts.get(slot.key) ?? new Map();
    const perService = {};
    let total = 0;

    for (const service of services) {
      const n = byService.get(service.key) ?? 0;
      perService[service.key] = n;
      total += n;
    }

    return {
      key: slot.key,
      label: slot.label,
      date: slot.date,
      count: total,
      byService: perService,
    };
  });
};

const buildServiceBreakdown = (services, facet) => {
  const todayByService = new Map((facet.todayByService ?? []).map((row) => [row._id, row.count]));
  const completedByService = new Map(
    (facet.completedByService ?? []).map((row) => [row._id, row.count])
  );

  return services.map((service) => ({
    key: service.key,
    label: service.label,
    today: todayByService.get(service.key) ?? 0,
    completed: completedByService.get(service.key) ?? 0,
  }));
};

module.exports = { buildTrend, buildServiceBreakdown };
