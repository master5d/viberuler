---
desops: contract/v1
status: ok
descriptor: 'CLI-бенчмарк: визуальный слой — терминал. Чёрно-белый ASCII-вывод, цвет
  только в статусах; интерфейса за пределами консоли нет.'
dials: {variance: 1, motion: 2, density: 5}
palette:
  dark: {bg: '#000000', accent: '#ffffff'}
tokens: inherit
---
# viberuler — DESIGN.md

## Что это за интерфейс

> Наследует `GLOBAL_DESIGN.md` NAUTILUS (C:\telo\Efforts\Ongoing\NAUTILUS\core\desops\GLOBAL_DESIGN.md). > Локальные расширения фиксируют ФАКТИЧЕСКУЮ визуальную ДНК проекта; core brand > identity не п

## Решения

- 2026-08-28: решение владельца — проект остаётся в реестре дизайна с пометкой «CLI, визуальный слой = терминал». dials описывают вывод консоли (декора нет, движение только в спиннере), а не вкус: генератору тут нечего рисовать
- 2026-08-27: контракт заведён миграцией (спек 2026-08-27-design-consolidation); dials НЕ выставлены — status draft, выставить при первом касании

## Не делать

- TODO(owner): перенести сюда проектные антипаттерны из legacy — `design/notes/legacy-DESIGN.md`
- (общелабораторное, не про этот проект) hex в разметке мимо токенов (`lint-design.ps1`)

## Доктрина

- `C:\telo\Efforts\Ongoing\NAUTILUS\core\desops\doctrine\INDEX.md`

## Legacy

Прежний DESIGN.md целиком: `design/notes/legacy-DESIGN.md` (ничего не потеряно).
