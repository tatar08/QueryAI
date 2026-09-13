use sqlparser::{
    ast::{Expr, Query, Select, Statement, TableFactor, Visit, Visitor},
    dialect::GenericDialect,
    parser::Parser,
};
use std::ops::ControlFlow;

/// Conservative SQL classification for UI and authorization checks. The database
/// must additionally enforce read-only transactions and least-privilege grants.
pub fn is_read_query(sql: &str) -> bool {
    let Ok(statements) = Parser::parse_sql(&GenericDialect {}, sql) else {
        return false;
    };
    statements.visit(&mut ReadOnly).is_continue()
}

struct ReadOnly;
impl Visitor for ReadOnly {
    type Break = ();
    fn pre_visit_statement(&mut self, statement: &Statement) -> ControlFlow<()> {
        match statement {
            Statement::Query(_)
            | Statement::Explain { .. }
            | Statement::ExplainTable { .. }
            | Statement::ShowTables { .. }
            | Statement::ShowVariable { .. }
            | Statement::ShowColumns { .. } => ControlFlow::Continue(()),
            _ => ControlFlow::Break(()),
        }
    }
    fn pre_visit_select(&mut self, select: &Select) -> ControlFlow<()> {
        if select.into.is_some() {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    }
    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<()> {
        if !query.locks.is_empty() {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    }
    fn pre_visit_table_factor(&mut self, factor: &TableFactor) -> ControlFlow<()> {
        match factor {
            TableFactor::Function { .. } | TableFactor::Table { args: Some(_), .. } => {
                ControlFlow::Break(())
            }
            _ => ControlFlow::Continue(()),
        }
    }
    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<()> {
        if let Expr::Function(function) = expr {
            let name = function.name.to_string().to_ascii_lowercase();
            // Only known built-in pure functions are classified as reads. Unknown
            // functions can execute arbitrary SQL, even from a SELECT expression.
            if !matches!(
                name.as_str(),
                "count"
                    | "sum"
                    | "avg"
                    | "min"
                    | "max"
                    | "coalesce"
                    | "nullif"
                    | "lower"
                    | "upper"
                    | "length"
                    | "char_length"
                    | "abs"
                    | "round"
                    | "ceil"
                    | "floor"
                    | "substring"
                    | "trim"
                    | "concat"
                    | "now"
                    | "date_trunc"
                    | "extract"
                    | "row_number"
                    | "rank"
                    | "dense_rank"
            ) {
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    }
}
