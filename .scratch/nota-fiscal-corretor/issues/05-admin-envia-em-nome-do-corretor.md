# 05: Admin envia nota em nome de um corretor

**What to build:** a controladoria, do próprio perfil de admin, escolhe um corretor da competência e
envia a nota dele — mesmo formulário, mesmas regras. É como ela testa a feature sem depender de
terceiros, e como destrava o corretor que não consegue enviar.

Fica registrado que foi ela quem enviou: o dono da nota é o corretor, o criador é o admin.

**Blocked by:** 02, 03.

**Status:** ready-for-agent

- [ ] A partir da linha de um corretor em "não enviaram", o admin abre o mesmo formulário de envio.
- [ ] O formulário vem pré-preenchido com o cadastro **daquele corretor**, não do admin.
- [ ] A nota gravada tem o corretor como dono e o admin como criador — dois campos distintos.
- [ ] O relatório da competência mostra quem criou o registro quando não foi o próprio corretor.
- [ ] Todas as regras do envio normal valem, incluindo a recusa da segunda nota do mesmo mês.
- [ ] Um corretor não consegue usar este caminho para enviar em nome de outro.
