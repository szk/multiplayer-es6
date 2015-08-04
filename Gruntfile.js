module.exports = function(grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        concat: {
            client: {
                options: { banner: "'use strict';\n" },
                src: ['src/CommonProc.es6.js',
                      'src/ClView.es6.js',
                      'src/ClSession.es6.js',
                      'src/ClPresenter.es6.js'],
                dest: 'dist/client.es6.js'
            },
            server: {
                options: { banner: "'use strict';\n" },
                src: ['src/CommonProc.es6.js',
                      'src/SvModel.es6.js',
                      'src/SvSession.es6.js',
                      'src/SvPresenter.es6.js'],
                dest: 'dist/app.es6.js'
            }
        },
        babel: {
            options: {
                sourceMap: true
            },
            dist: {
                files: {
                    'dist/client.js':'dist/client.es6.js',
                    'dist/app.js':'dist/app.es6.js'
                }
            }
        },
        watch: {
            options: {
                // spawn: false
                livereload: true
            },
            scripts: {
                files: ['src/*.js'],
                tasks: ['default']
            }
        }
    });

    grunt.loadNpmTasks('grunt-babel');
    grunt.loadNpmTasks('grunt-contrib-concat');
    grunt.loadNpmTasks('grunt-contrib-watch');

    grunt.registerTask('default', ['concat:client', 'concat:server', 'babel']);
    grunt.registerTask('start', ['watch']);
};
