CREATE TABLE `audit_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` text NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`at` text NOT NULL,
	`revision` integer NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text NOT NULL,
	`car_id` text,
	`action` text NOT NULL,
	`field` text,
	`before` text,
	`after` text
);
--> statement-breakpoint
CREATE INDEX `audit_events_book` ON `audit_events` (`book_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `audit_events_car` ON `audit_events` (`book_id`,`car_id`,`seq`);