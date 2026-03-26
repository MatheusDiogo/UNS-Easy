# UNS-Easy

Ferramenta para modelagem de arquiteturas UNS (Unified Namespace) de forma visual e automatizada.

---

## O que é?

UNS-Easy permite modelar a estrutura hierárquica de uma planta industrial e exportar automaticamente as configurações para o IntelligenceHub, incluindo modelos, instâncias, inputs OPC e outputs MQTT.

---

## Componentes

### Árvore Hierárquica
Modela a estrutura física/organizacional da planta:
```
Enterprise → Site → Área → Linha → Estação → Máquina
```

Arrasta, adiciona, renomeia e remove nós facilmente através de uma interface visual.

### Tipos de Nós

| Tipo | Descrição |
|------|-----------|
| **Instanciável** | Representa um equipamento real (ex: Machine, Robot, Conveyor). Pode ter atributos técnicos. |
| **Tópico** | Marca um nível como parte do caminho MQTT para publicação de dados. |
| **Input** | Marca um nó como ponto de entrada de dados (dados recebidos). |
| **Output** | Marca um nó como ponto de saída de dados (dados publicados). |
| **Folder** | Pasta organizacional, não gera dados. |

### Atributos
Cada nó instanciável pode ter atributos técnicos configurados:
- **Valor** - Valor padrão fixo
- **Input** - Endereço externo (será preenchido via planilha CSV)

Exemplos: `Temperature`, `Pressure`

### Conexões
Configura as conexões com sistemas externos:

- **OPC UA** - Fonte de dados de equipamentos industriais
  - Host, Porta, Path, Namespace Index

- **MQTT** - Broker para publicação de dados
  - Host, Porta, Client ID

### Planilha CSV
Fluxo de trabalho:

1. **Exportar CSV** - Gera uma planilha com todos os campos a serem preenchidos
2. **Preencher Endereços** - Completa os endereços OPC para cada equipamento
3. **Importar CSV** - Ao gerar o JSON, é possível importar a planilha preenchida

---

## Fluxo de Trabalho

1. **Criar Caso de Uso** - Nomeie o projeto (ex: "Linha de Montagem BH")

2. **Modelar Árvore** - Adicione nós hierárquicos conforme a estrutura da planta

3. **Definir Nós Instanciáveis** - Marque equipamentos reais e adicione seus atributos

4. **Configurar Conexões** - Defina os servidores OPC e brokers MQTT

5. **Exportar e Preencher CSV** - Gere a planilha e preencha os endereços

6. **Gerar JSON** - Importe o CSV preenchido e exporte o JSON final para o IntelligenceHub

---

## Saída Gerada

O JSON exportado contém:

| Seção | Descrição |
|-------|-----------|
| **Connections** | Configurações das conexões OPC e MQTT |
| **Inputs** | Endereços OPC lidos da planilha |
| **Outputs** | Tópicos MQTT para publicação |
| **Models** | Templates Structure, Config e Complete para cada nó instanciável |
| **Instances** | Equipamentos reais gerados automaticamente com dados da planilha |

---

## Modelos

Para cada nó instanciável, são gerados 3 modelos:

### Structure
Contém os nós do caminho hierárquico:
```
Plant, Shop, Line, Station, Machine
```

### Config
Contém os atributos técnicos do equipamento:
```
Temperature, Pressure
```

### Complete
Junção dos modelos Structure e Config em um único modelo completo.

---

## Instalação

### Docker (Recomendado)

```bash
docker compose up -d --build
```

Acesse: http://localhost:5000

### Local

```bash
pip install -r requirements.txt
python run.py
```

---

## Oportunidades

### 1. Otimização da Experiência do Usuário
- **Validação visual em tempo real** - Feedback imediato ao modelar a árvore
- **Templates pré-configurados** - Modelos prontos para cenários comuns (Packaging, Assembly, etc.)
- **Importação de estruturas existentes** - Upload de CSV/Excel para criar árvores rapidamente
- **Histórico de versões** - Comparar e restaurar casos de uso anteriores
- **Preview do JSON e Tópicos MQTT** - Visualizar a saída antes de exportar
- **Mais recurso na modelagem da árvore** - Arrastar e interligar nós

### 2. Novos Recursos
- **Suporte a múltiplos protocolos** - MQTT, OPC UA, Modbus, Siemens S7, etc.
- **Geração de documentação** - Exportar a modelagem como PDF/Word
- **Integração com sistemas de Automação** - Importar tags diretamente de Data Blocks
- **Validação semântica** - Verificar inconsistências na árvore (nós órfãos, atributos duplicados)
- **Colaboração em tempo real** - Múltiplos usuários editando simultaneamente
- **Análise de impacto** - Simular alterações antes de aplicar

### 3. Desacoplamento do IntelligenceHub
- **Exportação genérica** - Gerar JSON/CSV compatível com outros sistemas como o Node Red
- **Plugins de destino** - Arquitetura plugável para diferentes plataformas de destino
- **Templates de exportação** - Personalizar o formato de saída para cada sistema
- **APIs abertas** - Permitir integração com outras ferramentas