# Скиллы из материалов «сбежавшей нейросети»

Разобраны присланные фрагменты подборки скиллов, Agentic Discipline и руководства по Fable и Gemini. В текстовой выгрузке сохранились названия и часть путей репозиториев. Ссылки восстановлены по исходникам. Повторяющийся фрагмент Agentic Discipline посчитан один раз. Полнота относительно закрытой подборки зависит от полноты выгрузки.

## Взяли в проект

| Источник | Что добавляет | Как применили |
| --- | --- | --- |
| [Premortem, Дональд Фредерик](https://github.com/neurofoo/agent-skills/blob/0e7ac2aa4d094352a082ebeedf1dbb4c52b77782/premortem/SKILL.md) | Причины провала, ранние сигналы, ответственные и проверяемые меры | [Разбор пилота общей книги](pilot/shared-book-premortem.md) выявил три условия приёмки: доступ к книге и фото, сохранение правок с двух телефонов, совпадение денег с таблицей |
| [UX-copy, Людмила Сарычева и Никита Архипов](https://github.com/N1arko/redaktura-skills/tree/d1ebaff4fb8b97f939826a1cac284c10303be6f1/ux-copy) | Ошибка объясняет событие и следующий шаг, текст формы показывает последствие выбора | В форме автомобиля уточнили покупку из общей кассы и доли прибыли или убытка. При конфликте сохранения и сбое поиска указали, как продолжить |
| [XLSX, Anthropic](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/xlsx) | Изменяемые входные данные, формулы и проверка чисел | [Таблица сверки](pilot/reconciliation.xlsx) на трёх вымышленных сделках. Формулы и код Автобанка дали одинаковый результат |
| [Разбор пилота Автобанка](../skills/project/avtobank-review-pilot/SKILL.md) | Адаптация подхода Agentic Discipline с приёмкой по доказательствам и явными пробелами | Применён к общей книге. Для решений о деньгах и правах вывод связан с конкретным сценарием и проверкой |

Использованные инструкции зафиксированы в репозитории. Premortem и UX-copy работают как текстовые инструкции. Для XLSX использованы принципы построения и сверки формул. Полный набор инструментов для работы с файлами размещён у автора. Установщик редакторского пакета и его автоматическое обновление для этой работы не нужны.

## Уже используем

| Источник | Применимость |
| --- | --- |
| [Impeccable](https://github.com/pbakaus/impeccable) | Дизайн рабочих экранов и проверка на разных ширинах. Достаточно действующей версии в проекте |
| [Superpowers](https://github.com/obra/superpowers) и [Brainstorming](https://github.com/obra/superpowers/tree/main/skills/brainstorming) | Планирование, отдельная ветка, тесты и независимая проверка. Brainstorming нужен для предметных развилок в общей книге |
| [Scientific Critical Thinking](https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/scientific-critical-thinking) | Полезен для выводов о покрытии поиска VIN и экономии времени на пилоте. Выводы ограничены выборкой |
| [Taste Skill](https://github.com/Leonxlnx/taste-skill) | Дополнительный взгляд на иерархию и тексты. Подход применён в предыдущем дизайне рабочей панели |

## Остальные упоминания

| Скилл или набор | Применимость |
| --- | --- |
| [Feynman / eli5](https://github.com/companion-inc/feynman/tree/main/skills/eli5) | Объяснение сложных расчётов полезно в справке, когда появятся реальные вопросы партнёров |
| [Редакторский набор](https://github.com/N1arko/redaktura-skills) | redaktura, statya, post, promo и redpolitika полезны для длинных материалов и маркетинга. Для текущей задачи достаточно UX-copy |
| [Документные скиллы Anthropic](https://github.com/anthropics/skills/tree/main/skills) и [PDF OpenAI](https://github.com/openai/skills/tree/main/skills/.curated/pdf) | PDF может помочь проверять распечатку ДКП и отчёта. DOCX и PPTX стоит брать, когда появится такой документ |
| [Teach](https://github.com/mattpocock/skills/tree/main/skills/productivity/teach) и [Interview Coach](https://github.com/noamseg/interview-coach-skill) | Учебный курс и подготовка к собеседованиям. В рабочем сценарии перекупа потребности пока нет |
| [Gemini Frontend Design](https://github.com/google-gemini/demolab) и [Gemini API CLI](https://github.com/google-gemini/gemini-skills) | Ориентированы на экосистему Gemini и задачи генерации. Текущий дизайн уже поддерживается собственными соглашениями Автобанка |
| [OpenMontage](https://github.com/OpenMontageInc/OpenMontage), [HyperFrames](https://github.com/heygen-com/hyperframes/tree/main/skills/hyperframes) и [Remotion Skills](https://github.com/remotion-dev/skills) | Видеодемонстрации и маркетинг, когда потребуется ролик |
| [Baoyu Comic](https://github.com/JimLiu/baoyu-skills/tree/main/skills/baoyu-comic) и [Frontend Slides](https://github.com/zarazhangrui/frontend-slides) | Комиксы и презентации. Нужны только при отдельной задаче |

[Подборка на Sponsr](https://sponsr.ru/escaped_ai/188514/Kak_nadelit_svoi_II_supersposobnostyami_podborka_moshchnyh_skillov__i_rukovodstvo_po_poisku_novyh/)
