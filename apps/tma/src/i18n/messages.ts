export const messages = {
  ru: {
    common: {
      welcome: "Добро пожаловать в FreeMove",
      start_diagnosis: "Начать диагностику",
      exercisePlayer: "Плеер упражнений",
      deadlineLabel: "Дедлайн",
      panicButton: "Паник-кнопка",
      panicSending: "Отправляем сигнал...",
      panicDone: "Оператор уведомлен",
    },
  },
  en: {
    common: {
      welcome: "Welcome to FreeMove",
      start_diagnosis: "Start diagnosis",
      exercisePlayer: "Exercise player",
      deadlineLabel: "Deadline",
      panicButton: "Panic Button",
      panicSending: "Sending alert...",
      panicDone: "Operator alerted",
    },
  },
  ky: {
    common: {
      welcome: "FreeMove'го кош келиңиз",
      start_diagnosis: "Диагностиканы баштоо",
      exercisePlayer: "Көнүгүү ойноткучу",
      deadlineLabel: "Акыркы мөөнөт",
      panicButton: "Паника баскычы",
      panicSending: "Сигнал жөнөтүлүүдө...",
      panicDone: "Операторго билдирилди",
    },
  },
} as const;

export type SupportedLocale = keyof typeof messages;
