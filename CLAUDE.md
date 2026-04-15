# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repositorio GitHub

- **Repositorio:** https://github.com/matheusfmourao/projeto-claude-code
- **Branch principal:** main

## Regras de Commit Automatico

Sempre que houver uma alteracao no projeto (criacao, edicao ou remocao de arquivos), o Claude Code deve:

1. Fazer `git add` dos arquivos alterados
2. Criar um commit com uma mensagem descritiva em portugues
3. Fazer `git push origin main` para sincronizar com o GitHub

Isso garante que o repositorio remoto esteja sempre atualizado com o estado local do projeto.

## Comandos uteis

```bash
git status          # ver estado atual
git log --oneline   # ver historico de commits
git push origin main # enviar alteracoes para o GitHub
```
