module.exports = {
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    username: 'devops',
    password: 'changeme',
    database: 'devops',
    entities: ['dist/**/**/*.entity.js'],
    migrations: ['dist/migrations/*.js'],
    cli: {
      migrationsDir: 'src/migrations',
    },
  };