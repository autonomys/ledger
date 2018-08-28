# Subspace Module Boilerplate

A boilerplate repo for new subspace modules that includes

* [Typescript](https://www.typescriptlang.org/index.html)
* Supports testing with [Jest](https://jestjs.io/)
* [Yarn](https://yarnpkg.com/en/) for managing dependencies
* Node JS .gitignore

## Setup

Fork this repo and change the name to module_name  
Edit package.json with new module_name

```
$ git clone https://www.github.com/subspace/module_name
$ cd module_name
$ yarn
```

## Development

Start writing code in src/main.ts

Build manually.  
This will create an entry point at dist/main.js
 
```
$ tsc -w
```

[Instructions](https://code.visualstudio.com/docs/languages/typescript#_step-2-run-the-typescript-build) to automate with visual studio code.

## Testing

Write tests in src/main.tests.ts (example provided) and run with

```
$ npx jest
```

## External Usage

Install this module as a dependency into another project

```
$ yarn add 'https://www.github.io/subspace/module_name'
```

Require this module inside a script

```javascript
const module_name = require('module_name').default
```
