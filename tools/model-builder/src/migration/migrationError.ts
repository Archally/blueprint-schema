/**
 * Error thrown when migration application fails (invalid target, missing data, etc.).
 */
export class MigrationError extends Error {
  public migrationId?: string;
  public changeIndex?: number;

  constructor(message: string, migrationId?: string, changeIndex?: number) {
    super(message);
    this.name = 'MigrationError';
    this.migrationId = migrationId;
    this.changeIndex = changeIndex;
  }
}
