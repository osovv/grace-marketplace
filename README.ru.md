# GRACE Marketplace и CLI

[Read in English](README.md)

**GRACE** означает **Graph-RAG Anchored Code Engineering**: contract-first методологию AI-разработки, построенную вокруг семантической разметки, общих XML-артефактов, планирования верификации и навигации по графу знаний.

Этот репозиторий поставляет навыки GRACE и опциональный CLI `grace`. Это репозиторий упаковки и дистрибуции, а не конечное пользовательское приложение.

Текущая упакованная версия: `3.7.0`

## Что поставляет этот репозиторий

- Канонические навыки GRACE в `skills/grace/*`
- Зеркало для Claude Marketplace в `plugins/grace/skills/grace/*`
- Метаданные маркетплейса в `.claude-plugin/marketplace.json`
- Манифест упакованного плагина в `plugins/grace/.claude-plugin/plugin.json`
- Метаданные OpenPackage в `openpackage.yml`
- Опциональный CLI-пакет на Bun `@osovv/grace-cli`

Сейчас опубликованный CLI дает:

- `grace lint` для проверок целостности
- `grace module find` для разрешения модулей по общим документам и file-local разметке
- `grace module show` для общего/публичного контекста модуля
- `grace file show` для file-local/приватного контекста реализации

## Зачем нужен GRACE

GRACE спроектирован для AI-assisted engineering, где агентам нужны стабильная навигация, явные контракты и переиспользуемые артефакты верификации.

Ключевые идеи:

- общие артефакты определяют публичную границу модуля
- file-local разметка определяет приватные детали реализации
- контракты описывают ожидаемое поведение до того, как изменения начнут распространяться по коду
- верификация планируется, именуется и переиспользуется вместо импровизации под каждую задачу
- семантические блоки дают агентам точные цели для чтения и патчинга

Это упрощает:

- проектирование модулей и порядка выполнения
- передачу работы между агентами без потери контекста
- ревью на предмет дрейфа между кодом, графом и верификацией
- отладку падений по именованным блокам и заранее спланированным доказательствам

GRACE разработан Владимиром Ивановым ([@turboplanner](https://t.me/turboplanner)).

## Установка

Сначала установите **навыки**.

- Навыки — основная продуктовая поверхность GRACE.
- CLI опционален, но настоятельно рекомендуется после установки навыков.
- Установка только навыков — валидный сценарий.
- Установка только CLI обычно мало полезна без навыков и рабочего процесса GRACE.

### Установка навыков

Навыки и CLI дополняют друг друга, но распространяются по-разному.

#### OpenPackage

```bash
opkg install gh@osovv/grace-marketplace
opkg install gh@osovv/grace-marketplace -g
opkg install gh@osovv/grace-marketplace --platforms claude-code
```

#### Claude Code Marketplace

```bash
/plugin marketplace add osovv/grace-marketplace
/plugin install grace@grace-marketplace
```

#### Установка для систем, совместимых с Agent Skills

```bash
git clone https://github.com/osovv/grace-marketplace
cp -r grace-marketplace/skills/grace/grace-* /path/to/your/agent/skills/
```

### Установка CLI

CLI — это компаньон для навыков GRACE, а не их замена.

Требуется `bun` в `PATH`.

```bash
bun add -g @osovv/grace-cli
grace lint --path /path/to/grace-project
```

## Быстрый старт

Для нового GRACE-проекта:

1. Запустите `$grace-init`
2. Спроектируйте `docs/requirements.xml` и `docs/technology.xml` вместе с вашим агентом
3. Запустите `$grace-plan`
4. Запустите `$grace-verification`
5. Запустите `$grace-execute` или `$grace-multiagent-execute`

Для существующего GRACE-проекта CLI часто является самым быстрым способом сориентироваться:

```bash
# Проверка целостности
grace lint --path /path/to/project

# Найти нужный модуль
grace module find auth --path /path/to/project
grace module find src/provider/config-repo.ts --path /path/to/project --json

# Прочитать общий/публичный контекст
grace module show M-AUTH --path /path/to/project
grace module show M-AUTH --path /path/to/project --with verification

# Прочитать file-local/приватный контекст
grace file show src/auth/index.ts --path /path/to/project
grace file show src/auth/index.ts --path /path/to/project --contracts --blocks
```

## Обзор навыков

| Навык | Назначение |
| --- | --- |
| `grace-init` | Инициализирует документы GRACE, шаблоны и инструкции для агентов |
| `grace-plan` | Проектирует модули, фазы, потоки, зависимости и контракты |
| `grace-verification` | Создает и поддерживает `verification-plan.xml`, тесты, трассы и лог-доказательства |
| `grace-execute` | Выполняет план последовательно с локальным ревью и коммитами |
| `grace-multiagent-execute` | Выполняет parallel-safe волны с синхронизацией через управляющего агента |
| `grace-refactor` | Переименовывает, перемещает, делит, объединяет и извлекает модули без дрейфа shared-артефактов |
| `grace-fix` | Отлаживает проблемы по графу, контрактам, тестам, трассам и семантическим блокам |
| `grace-refresh` | Обновляет граф и артефакты верификации по реальному состоянию кодовой базы |
| `grace-reviewer` | Проверяет семантическую целостность, согласованность графа и качество верификации |
| `grace-status` | Показывает общее состояние проекта и предлагает следующее безопасное действие |
| `grace-ask` | Отвечает на вопросы по архитектуре и реализации на основе проектных артефактов |
| `grace-cli` | Использует опциональный бинарник `grace` как быстрый слой lint и запросов к артефактам GRACE-проектов |
| `grace-explainer` | Объясняет саму методологию GRACE |
| `grace-setup-subagents` | Генерирует shell-specific пресеты воркеров и ревьюеров GRACE |

## Обзор CLI

| Команда | Что делает |
| --- | --- |
| `grace lint --path <root>` | Валидирует текущие артефакты GRACE, семантическую разметку, уникальные XML-теги и дрейф export/map |
| `grace module find <query> --path <root>` | Ищет по ID модуля, имени, пути, назначению, аннотациям, ID зависимостей, ID верификации и `LINKS` |
| `grace module show <id-or-path> --path <root>` | Показывает общий/публичный модульный record из плана, графа, шагов и связанных файлов |
| `grace module show <id> --with verification --path <root>` | Добавляет фрагмент верификации, если существует запись `V-M-*` |
| `grace file show <path> --path <root>` | Показывает file-local `MODULE_CONTRACT`, `MODULE_MAP` и `CHANGE_SUMMARY` |
| `grace file show <path> --contracts --blocks --path <root>` | Добавляет локальные контракты и навигацию по семантическим блокам |

Текущие режимы вывода:

- `grace lint`: `text`, `json`
- `grace module find`: `table`, `json`
- `grace module show`: `text`, `json`
- `grace file show`: `text`, `json`

## Публичные shared docs и file-local разметка

GRACE работает лучше всего, когда shared docs остаются публичными и стабильными, а приватные детали находятся рядом с кодом.

Используйте общие XML-артефакты для:

- ID модулей и границ модулей
- публичных контрактов модулей и публичных интерфейсов
- зависимостей и порядка выполнения
- записей верификации, команд, сценариев и обязательных маркеров
- проектных потоков и фаз

Используйте file-local разметку для:

- `MODULE_CONTRACT`
- `MODULE_MAP`
- `CHANGE_SUMMARY`
- контрактов функций и типов
- границ семантических блоков
- helper-функций и деталей оркестрации, нужных только реализации

Практическое правило:

- `grace module show` — общий/публичный источник истины
- `grace file show` — file-local/приватный источник истины

## Основные артефакты GRACE

| Артефакт | Роль |
| --- | --- |
| `docs/requirements.xml` | Продуктовый замысел, границы, use cases и требования |
| `docs/technology.xml` | Стек, инструменты, ограничения, runtime и выбор тестирования |
| `docs/development-plan.xml` | Модули, контракты, порядок реализации, фазы и потоки |
| `docs/verification-plan.xml` | Записи верификации, тестовые команды, сценарии и обязательные маркеры |
| `docs/knowledge-graph.xml` | Карта модулей, зависимости, публичные аннотации и граф навигации |
| `docs/operational-packets.xml` | Канонические шаблоны execution packet, delta и handoff при сбоях |
| `src/**/*` и `tests/**/*` с разметкой GRACE | File-local контекст модуля, контракты и границы семантических блоков |

## Типовые сценарии работы

### Инициализация нового проекта

```text
$grace-init
design requirements.xml and technology.xml together with your agent
$grace-plan
$grace-verification
$grace-execute or $grace-multiagent-execute
```

### Быстро изучить один модуль

```text
grace module find <name-or-path>
grace module show M-XXX --with verification
grace file show <governed-file> --contracts --blocks
```

### Проверка или обновление после дрейфа кода

```text
grace lint --path <project-root>
$grace-reviewer
$grace-refresh
```

### Отладка падающего потока

```text
grace module find <error-or-path>
grace module show M-XXX --with verification
grace file show <governed-file> --contracts --blocks
$grace-fix
```

## Структура репозитория

| Путь | Назначение |
| --- | --- |
| `skills/grace/*` | Канонические исходники навыков |
| `plugins/grace/skills/grace/*` | Упакованное зеркало для распространения через маркетплейс |
| `.claude-plugin/marketplace.json` | Запись маркетплейса и опубликованный набор навыков |
| `plugins/grace/.claude-plugin/plugin.json` | Манифест упакованного плагина |
| `src/grace.ts` | Точка входа CLI |
| `src/grace-lint.ts` | Команда `grace lint` |
| `src/grace-module.ts` | Команды `grace module find/show` |
| `src/grace-file.ts` | Команда `grace file show` |
| `src/query/*` | Загрузка артефактов, индексация и слой рендеринга для CLI-запросов |
| `scripts/validate-marketplace.ts` | Валидация упаковки и релиза |

## Для мейнтейнеров

- Считайте `skills/grace/*` источником истины, если задача явно не относится к упакованному выводу.
- Поддерживайте синхронизацию `plugins/grace/skills/grace/*` с каноническими файлами навыков.
- Поддерживайте синхронизацию версий между `README.md`, `package.json`, `openpackage.yml`, `.claude-plugin/marketplace.json` и `plugins/grace/.claude-plugin/plugin.json`.
- Проверяйте изменения упаковки командой `bun run ./scripts/validate-marketplace.ts`.
- Проверяйте изменения CLI командами `bun run ./src/grace.ts lint --path . --allow-missing-docs` и `bun test`.
- Не предполагайте, что каждая директория в `skills/grace/` публикуется; фактический набор поставки объявлен в `.claude-plugin/marketplace.json`.

## Разработка и валидация

Установите зависимости:

```bash
bun install
```

Запустите тесты:

```bash
bun test
```

Запустите CLI на самом репозитории:

```bash
bun run ./src/grace.ts lint --path . --allow-missing-docs
```

Запустите проверку маркетплейса и упаковки:

```bash
bun run ./scripts/validate-marketplace.ts
```

Проведите smoke test query-слоя на реальном GRACE-проекте:

```bash
bun run ./src/grace.ts module show M-AUTH --path /path/to/grace-project --with verification
bun run ./src/grace.ts file show src/auth/index.ts --path /path/to/grace-project --contracts --blocks
```

## Лицензия

MIT
