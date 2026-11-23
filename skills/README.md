# Скиллы Автобанка

В репозитории лежат версии инструкций, использованных в проекте. Читай нужный `SKILL.md` из таблицы, затем его справочные материалы. Команды приложения и CI работают независимо от этого каталога. Автозапуск хуков не настроен.

| Скилл | Где лежит | Как используется |
| --- | --- | --- |
| Impeccable | [Инструкция, справочник и запуск CLI](upstream/impeccable/SKILL.md) | Рабочие экраны, контекст продукта, визуальная проверка и доводка |
| taste-skill | [Инструкция и справочник](upstream/taste-skill/SKILL.md) | Иерархия экрана, единая система элементов и проверка в браузере |
| Superpowers | [Инструкции по работе с проектом](upstream/superpowers/) | Идеи и планы, изолированные ветки, диагностика, тесты до исправления, ревью и выпуск |
| Scientific Critical Thinking | [Инструкция и справочник](upstream/scientific-critical-thinking/SKILL.md) | Проверка применимости источников и выводов к реальным сценариям Автобанка |
| deliver-ai-tasks | [Инструкция проекта](project/deliver-ai-tasks/SKILL.md) | Критерии приёмки и проверка результата перед передачей |
| evaluate-ai-skills | [Инструкция проекта](project/evaluate-ai-skills/SKILL.md) | Оценка исходников, разрешений и пользы сторонних скиллов |

## Зафиксированные версии

- [Impeccable](https://github.com/pbakaus/impeccable/tree/b49177d32788f2dc585c42831d845dacf1ebed2c/.agents/skills/impeccable), Apache-2.0. Для live-режима, полного индекса шрифтов и шаблонов агентов используй эту ревизию источника. CLI может загрузить проверяемый по контрольной сумме бинарник из релиза.
- [taste-skill](https://github.com/Leonxlnx/taste-skill/tree/6c0b5c78f5d31776e2210305abaa210cdc0030bf/skills/taste-skill), MIT. Комплект демонстрационных изображений, эффектов и инструментов проверки маркетинговых страниц находится в этой ревизии источника. Для рабочего приложения применяем проверки состояния, размеров и действий из [DESIGN.md](../DESIGN.md).
- [Superpowers](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7/skills), MIT. Сохранены рабочие инструкции и их локальные материалы.
- [Scientific Critical Thinking](https://github.com/K-Dense-AI/scientific-agent-skills/tree/c21d13b3cc2894680229ba9959a53281acb9200e/skills/scientific-critical-thinking), MIT. Для сравнения вариантов приложения достаточно инструкции и справочника.
