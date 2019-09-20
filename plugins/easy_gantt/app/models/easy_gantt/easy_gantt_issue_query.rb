module EasyGantt
	class EasyGanttIssueQuery < IssueQuery

	attr_accessor :entity_scope
	attr_accessor :opened_project

	def default_columns_names
		[:subject, :priority, :assigned_to]
	end

	def entity
		Issue
	end

	def from_params(params)
		build_from_params(params)
	end

	def to_params
		params = { set_filter: 1, type: self.class.name, f: [], op: {}, v: {} }

		filters.each do |filter_name, opts|
		params[:f] << filter_name
		params[:op][filter_name] = opts[:operator]
		params[:v][filter_name] = opts[:values]
		end

		params[:c] = column_names
		params
	end

	def to_partial_path
		'easy_gantt/easy_queries/show'
	end

	def initialize_available_filters
		super
		@available_filters.delete('subproject_id')
	end

	def entity_scope
		@entity_scope ||= begin
		scope = Issue.visible
		if Project.column_names.include? 'easy_baseline_for_id'
			scope = scope.where(Project.table_name => {easy_baseline_for_id: nil})
	end
	scope
		end
	end

	def create_entity_scope(options={})
		entity_scope.includes(options[:includes]).
		references(options[:includes]).
		preload(options[:preload]).
		where(statement).
		where(options[:conditions])
	end

	def entities(options={})
		create_entity_scope(options).order(options[:order])
	end

	def get_children_conditions(p_table, opened_project) # factored out this part of load_project in easy_gantt_controller.rb to use it in project_statement down below

		projects = without_opened_project { |q|
			scope = q.create_entity_scope

			# fetch projects which lft are higher than opened project lft and rgt that are lower than opened project rgt, will take only subprojects
			#
			#      for Project A lft is 1 and rgt is 10, so if we want A and subs, we fetch rgt >= 1 && lft <= 10
			#
			#              1   Project A 10
			#     2 Project A.C 5--|-- 6 Project A.B 9
			#       /                  `-- 7 Project A.B.C 8
			# 3 Project A.C.A 4
			#
			#              11   Project B 20
			#     12 Project B.C 15--|-- 16 Project B.B 19
			#       /                    `-- 17 Project B.B.C 18
			# 13 Project B.C.A 14

			if opened_project
				scope = scope.where("#{p_table}.lft >= ? AND #{p_table}.rgt <= ?", opened_project.lft, opened_project.rgt) # scope down the subtree
			end

			scope.distinct.pluck("#{p_table}.lft, #{p_table}.rgt")
		}
		if projects.blank?
			return
		end

		# All children conditions
		tree_conditions = []
		projects.each do |lft, rgt|
			tree_conditions << "(#{p_table}.lft = #{lft} AND #{p_table}.rgt = #{rgt})" # write the condition for each project.
		end
		tree_conditions = tree_conditions.join(' OR ')
	end

	def project_statement
		p_table = Project.table_name

		conditions = "#{p_table}.status = #{Project::STATUS_ACTIVE}"
		if opened_project
			tree_condition = get_children_conditions p_table, opened_project
			conditions = "#{conditions} AND (#{tree_condition})" # we have to add parenthesis since tree_condition is a list
		end
		conditions
	end

	def without_opened_project
		_opened_project = opened_project
		self.opened_project = nil
		yield self
		ensure
			self.opened_project = _opened_project
		end
	end
end
