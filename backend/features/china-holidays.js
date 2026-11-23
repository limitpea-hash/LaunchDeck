// State Council General Office notices, 国办发明电〔2024〕12号、〔2025〕7号、〔2026〕10号.
// Each entry is [holiday name, first day, last day, adjusted workdays].
const publishedSchedules = {
  2025: [
    ['元旦', '01-01', '01-01', []],
    ['春节', '01-28', '02-04', ['01-26', '02-08']],
    ['清明节', '04-04', '04-06', []],
    ['劳动节', '05-01', '05-05', ['04-27']],
    ['端午节', '05-31', '06-02', []],
    ['国庆节与中秋节', '10-01', '10-08', ['09-28', '10-11']],
  ],
  2026: [
    ['元旦', '01-01', '01-03', ['01-04']],
    ['春节', '02-15', '02-23', ['02-14', '02-28']],
    ['清明节', '04-04', '04-06', []],
    ['劳动节', '05-01', '05-05', ['05-09']],
    ['端午节', '06-19', '06-21', []],
    ['中秋节', '09-25', '09-27', []],
    ['国庆节', '10-01', '10-07', ['09-20', '10-10']],
  ],
  2027: [
    ['元旦', '01-01', '01-03', []],
    ['春节', '02-05', '02-13', ['01-31', '02-14']],
    ['清明节', '04-03', '04-05', []],
    ['劳动节', '05-01', '05-05', ['05-08']],
    ['端午节', '06-09', '06-09', []],
    ['中秋节', '09-15', '09-15', []],
    ['国庆节', '10-01', '10-07', ['09-26', '10-09']],
  ],
};

const byDate = new Map();
for (const [year, periods] of Object.entries(publishedSchedules)) {
  for (const [name, first, last, workdays] of periods) {
    const holiday = Object.freeze({ kind: 'holiday', name });
    const until = Date.parse(`${year}-${last}T00:00:00Z`);
    for (let time = Date.parse(`${year}-${first}T00:00:00Z`); time <= until; time += 86400000) {
      byDate.set(new Date(time).toISOString().slice(0, 10), holiday);
    }
    const workday = Object.freeze({ kind: 'workday', name });
    for (const day of workdays) byDate.set(`${year}-${day}`, workday);
  }
}

export function hasChinaHolidaySchedule(year) {
  return Object.hasOwn(publishedSchedules, year);
}

export function getChinaHoliday(date) {
  return byDate.get(date) ?? null;
}
